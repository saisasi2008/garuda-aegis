import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .api.dossier import AirspaceIntrusionDossier
from .core.physics_engine import DronePhysicsEngine
from .defense.rf_jammer import DirectionalRFJammer
from .fusion.track_manager import MultiTargetTrackManager
from .sensors.radar_3d import Radar3DSensor
from .sensors.rf_direction_finder import RFDirectionFinder
from .simulation.swarm_manager import SwarmSimulationManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("garuda_aegis")

# Shared Simulation Subsystems
DT_TICK = 0.05  # 20 Hz
physics_engine = DronePhysicsEngine()
swarm_sim = SwarmSimulationManager(physics_engine=physics_engine, dt=DT_TICK)
radar_sensor = Radar3DSensor()
rf_sensor = RFDirectionFinder()
track_manager = MultiTargetTrackManager(dt=DT_TICK)
rf_jammer = DirectionalRFJammer()

# Track history store for forensic trajectory reconstruction
track_history: dict[str, list[dict[str, float]]] = {}
anomaly_logs: dict[str, list[str]] = {}

# Active WebSocket client connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket client connected. Total clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket client disconnected. Total clients: {len(self.active_connections)}")

    async def broadcast_json(self, message: dict[str, Any]):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except (WebSocketDisconnect, RuntimeError):
                disconnected.append(connection)
        for dead in disconnected:
            self.disconnect(dead)


ws_manager = ConnectionManager()
simulation_running = True
frame_counter = 0


async def simulation_tick_loop():
    """20 Hz (dt = 0.05s) Real-Time Aerospace Simulation, Sensor Physics & Fusion Pipeline."""
    global frame_counter
    logger.info("Initializing Garuda-Aegis 20Hz Simulation Event Loop...")
    swarm_sim.initialize_default_scenario()
    rf_jammer.deactivate_jammer()

    while simulation_running:
        start_time = time.perf_counter()
        current_epoch = time.time()
        frame_counter += 1

        try:
            # 1. Swarm Kinematics Step (Gauss-Markov + 6-DOF Aerodynamic Drag & Downwash)
            drones_ground_truth = swarm_sim.step_simulation()

            # 2. Radar & RF Sensor Step (Swerling 1 RCS, CFAR, micro-Doppler, Root-MUSIC DoA, GNSS Residuals)
            radar_dets = radar_sensor.scan_airspace(drones_ground_truth)
            radar_dicts = [d.to_dict() for d in radar_dets]

            rf_bearings = rf_sensor.intercept_emissions(
                true_drones=drones_ground_truth,
                fused_tracks=track_manager.tracks,
            )
            rf_dicts = [b.to_dict() for b in rf_bearings]

            # 3. Multi-Sensor Data Fusion Step (UKF 9-state CA filter + Hungarian GNN association)
            track_manager.step_fusion(
                radar_detections=radar_dicts,
                rf_bearings=rf_dicts,
                current_time=current_epoch,
            )

            # 4. Electronic Warfare Soft-Kill Step
            # If jammer is targeting a specific track, automatically aim at its current fused position
            if rf_jammer.is_active and rf_jammer.target_track_id:
                tgt_track = track_manager.tracks.get(rf_jammer.target_track_id)
                if tgt_track:
                    p = tgt_track.ukf.position
                    r = max(float(np.linalg.norm(p)), 1.0)
                    rf_jammer.aim_az_rad = float(np.arctan2(p[1], p[0]))
                    rf_jammer.aim_el_rad = float(np.arcsin(np.clip(p[2] / r, -1.0, 1.0)))

            # Evaluate jamming impact against all swarm drones with progressive DT exposure
            for drone in swarm_sim.drones.values():
                res = rf_jammer.evaluate_jamming_on_drone(
                    drone_id=drone.drone_id,
                    drone_pos=drone.position,
                    dt=DT_TICK,
                )
                swarm_sim.update_drone_link_state(drone.drone_id, res.link_state)

                # Reflect EW status in fused tracks if matching
                for trk in track_manager.tracks.values():
                    if np.linalg.norm(trk.ukf.position - drone.position) < 40.0:
                        trk.link_sinr_db = res.sinr_db
                        trk.packet_loss_pct = res.per * 100.0
                        if drone.link_state == "NEUTRALIZED":
                            trk.ew_status = "NEUTRALIZED"
                        elif res.link_state in ("FORCED_LANDING", "HOVER_LOCK", "LINK_LOST"):
                            trk.ew_status = res.link_state
                        elif res.link_state == "NORMAL" and trk.ew_status != "NEUTRALIZED":
                            trk.ew_status = "MONITORING"

            # Record track histories for forensic dossier generation
            for trk in track_manager.tracks.values():
                pos = trk.ukf.position
                if trk.track_id not in track_history:
                    track_history[trk.track_id] = []
                    anomaly_logs[trk.track_id] = []
                track_history[trk.track_id].append({
                    "x": float(pos[0]),
                    "y": float(pos[1]),
                    "z": float(pos[2]),
                    "t": current_epoch,
                })
                if trk.gnss_spoof_flag and "GNSS_SPOOFING_DETECTED" not in anomaly_logs[trk.track_id]:
                    anomaly_logs[trk.track_id].append("GNSS_SPOOFING_DETECTED")
                if trk.ew_status != "MONITORING" and trk.ew_status not in anomaly_logs[trk.track_id]:
                    anomaly_logs[trk.track_id].append(f"EW_COUNTERMEASURE_{trk.ew_status}")

            # 5. Broadcast live telemetry packet over WebSockets
            if ws_manager.active_connections:
                telemetry_payload = {
                    "timestamp": current_epoch,
                    "frame": frame_counter,
                    "tracks": [t.to_dict() for t in track_manager.tracks.values()],
                    "ground_truth_drones": drones_ground_truth,
                    "radar_detections": radar_dicts,
                    "rf_bearings": rf_dicts,
                    "sensors": {
                        "radar_stats": {
                            "fc_ghz": 10.0,
                            "pt_w": 150.0,
                            "cpi_pulses": 64,
                            "pfa": 1e-6,
                            "detection_count": len(radar_dicts),
                        },
                        "rf_stats": {
                            "array_elements": 8,
                            "algorithm": "ROOT_MUSIC_360",
                            "detection_count": len(rf_dicts),
                            "active_protocols": list({b["protocol"] for b in rf_dicts}),
                        },
                        "gnss_stats": {
                            "nominal_cn0": 43.0,
                            "gate_chi2": 16.266,
                            "spoofed_count": sum(1 for b in rf_dicts if b.get("gnss_spoof_flag")),
                        },
                        "micro_doppler_stats": {
                            "uav_min_flash_hz": 600.0,
                            "avian_max_flash_hz": 60.0,
                            "mean_rpm": 5600.0,
                        },
                    },
                    "jammer_status": {
                        "is_active": rf_jammer.is_active,
                        "aim_az_deg": float(np.rad2deg(rf_jammer.aim_az_rad)),
                        "aim_el_deg": float(np.rad2deg(rf_jammer.aim_el_rad)),
                        "power_w": float(rf_jammer.power_w),
                        "freq_mhz": float(rf_jammer.freq_mhz),
                        "target_track_id": rf_jammer.target_track_id,
                    },
                }
                await ws_manager.broadcast_json(telemetry_payload)

        except Exception:
            logger.exception(f"Error in simulation frame {frame_counter}")

        elapsed = time.perf_counter() - start_time
        sleep_time = max(0.0, DT_TICK - elapsed)
        await asyncio.sleep(sleep_time)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global simulation_running
    simulation_running = True
    sim_task = asyncio.create_task(simulation_tick_loop())
    yield
    simulation_running = False
    sim_task.cancel()
    try:
        await sim_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Garuda-Aegis (SIH26247) C-UAS Defense Platform",
    description="Multi-Sensor Fusion (UKF/GNN), Radar/RF Physics & EW Jamming Tactical Backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class JamRequest(BaseModel):
    azimuth_deg: float = Field(default=0.0, description="Jammer Azimuth pointing angle in degrees")
    elevation_deg: float = Field(default=10.0, description="Jammer Elevation pointing angle in degrees")
    power_w: float = Field(default=50.0, description="RF Power in Watts (up to 200W)")
    frequency_mhz: float = Field(default=2440.0, description="Target frequency band (MHz)")
    bandwidth_mhz: float = Field(default=40.0, description="Jamming bandwidth (MHz)")
    target_track_id: str | None = Field(default=None, description="Optional track ID to lock-on target")


@app.get("/api/v1/health")
async def health_check():
    return {
        "status": "HEALTHY",
        "system": "Garuda-Aegis C-UAS",
        "simulation_frequency_hz": 20.0,
        "active_tracks_count": len(track_manager.tracks),
        "jammer_active": rf_jammer.is_active,
    }


@app.post("/api/v1/defense/jam")
async def trigger_jamming(req: JamRequest):
    """Activates high-power directional RF countermeasure against target drone/track."""
    res = rf_jammer.activate_directional_jammer(
        azimuth_rad=float(np.deg2rad(req.azimuth_deg)),
        elevation_rad=float(np.deg2rad(req.elevation_deg)),
        power_w=req.power_w,
        freq_mhz=req.frequency_mhz,
        bandwidth_mhz=req.bandwidth_mhz,
        target_track_id=req.target_track_id,
    )
    logger.warning(f"EW Directional Jammer ACTIVATED: {res}")
    return res


@app.post("/api/v1/defense/disarm")
async def disarm_jamming():
    """Deactivates RF countermeasure."""
    res = rf_jammer.deactivate_jammer()
    logger.info("EW Directional Jammer DEACTIVATED")
    return res


@app.get("/api/v1/defense/status")
async def get_jammer_status():
    return {
        "is_active": rf_jammer.is_active,
        "aim_az_deg": float(np.rad2deg(rf_jammer.aim_az_rad)),
        "aim_el_deg": float(np.rad2deg(rf_jammer.aim_el_rad)),
        "power_w": float(rf_jammer.power_w),
        "freq_mhz": float(rf_jammer.freq_mhz),
        "target_track_id": rf_jammer.target_track_id,
    }


@app.post("/api/v1/simulation/reset")
async def reset_simulation():
    """Resets swarm simulation, fusion tracks, and jammer state."""
    rf_jammer.deactivate_jammer()
    track_manager.tracks.clear()
    track_history.clear()
    anomaly_logs.clear()
    swarm_sim.initialize_default_scenario()
    logger.info("Simulation scenario and tracks reset to default state.")
    return {"status": "RESET_SUCCESSFUL"}


@app.post("/api/v1/simulation/spawn-swarm")
async def spawn_swarm_raid():
    """Dynamically spawns a coordinated 6-drone multi-sector attack raid."""
    new_ids = swarm_sim.spawn_multi_sector_swarm(count=6)
    logger.warning(f"Spawned 6-Drone Multi-Sector Swarm Raid: {new_ids}")
    return {"status": "SWARM_SPAWNED", "drone_ids": new_ids}


@app.post("/api/v1/defense/spoof-redirect")
async def redirect_spoofed_attackers():
    """Transmits deceptive ephemeris to deflect GNSS spoofed drones away from the protected zone."""
    count = swarm_sim.redirect_spoofed_drones()
    logger.warning(f"GNSS Spoofing Countermeasure: Redirected {count} drones away from base.")
    return {"status": "SPOOF_REDIRECT_ACTIVE", "redirected_count": count}


@app.get("/api/v1/forensics/dossier/{target_id}")
async def get_forensic_dossier(target_id: str):
    """Produces cryptographic legal-defense-grade incident documentation conforming to FAA Part 89/107."""
    trk = track_manager.tracks.get(target_id)
    history = track_history.get(target_id, [])
    anomalies = anomaly_logs.get(target_id, [])

    if not trk and not history:
        raise HTTPException(status_code=404, detail=f"No track records found for ID {target_id}")

    protocol = trk.target_protocol if trk else "MAVLINK_SIK_OR_OCUSYNC"
    classification = trk.classification if trk else "HOSTILE_QUADCOPTER"
    threat = "CRITICAL_AIRSPACE_BREACH"
    micro_doppler = trk.micro_doppler_hz if trk else 1250.0
    ew_status = trk.ew_status if trk else "MONITORING"

    dossier = AirspaceIntrusionDossier.generate_signed_dossier(
        target_id=target_id,
        protocol=protocol,
        threat_level=threat,
        coordinates_path=history[-50:],  # Last 50 positions
        rf_anomalies=anomalies,
        classification=classification,
        micro_doppler_hz=micro_doppler,
        jammer_impact=ew_status,
    )
    return dossier


@app.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    """Real-time 20 Hz telemetry WebSocket stream for React/WebGL C2 UI."""
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep socket open and accept potential operator client commands
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except (ConnectionResetError, RuntimeError) as e:
        logger.warning(f"WebSocket client error: {e}")
        ws_manager.disconnect(websocket)
