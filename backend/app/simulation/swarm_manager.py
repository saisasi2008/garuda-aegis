from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ..core.physics_engine import DronePhysicsEngine


@dataclass
class SwarmDrone:
    drone_id: str
    position: np.ndarray
    velocity: np.ndarray
    commanded_accel: np.ndarray = field(default_factory=lambda: np.zeros(3))
    link_state: str = "NORMAL"  # NORMAL, LINK_LOST, HOVER_LOCK, FORCED_LANDING, NEUTRALIZED
    rcs_mean: float = 0.035
    rotor_rpm: float = 5800.0
    frequency_mhz: float = 2440.0
    carrier_to_noise_db_hz: float = 43.0
    rf_transmitting: bool = True
    spoofed_gnss_position: np.ndarray | None = None
    waypoints: list[np.ndarray] = field(default_factory=list)
    current_wp_idx: int = 0
    alpha_gm: float = 0.85  # Gauss-Markov memory parameter
    mean_speed: float = 12.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "drone_id": self.drone_id,
            "position": [float(self.position[0]), float(self.position[1]), float(self.position[2])],
            "velocity": [float(self.velocity[0]), float(self.velocity[1]), float(self.velocity[2])],
            "speed_mps": float(np.linalg.norm(self.velocity)),
            "link_state": self.link_state,
            "rcs_mean": float(self.rcs_mean),
            "rotor_rpm": float(self.rotor_rpm),
            "frequency_mhz": float(self.frequency_mhz),
            "carrier_to_noise_db_hz": float(self.carrier_to_noise_db_hz),
            "rf_transmitting": self.rf_transmitting,
            "spoofed_gnss": (
                [float(self.spoofed_gnss_position[0]), float(self.spoofed_gnss_position[1]), float(self.spoofed_gnss_position[2])]
                if self.spoofed_gnss_position is not None
                else None
            ),
        }


class SwarmSimulationManager:
    """
    Simulates multi-UAV hostile swarm with:
    - 3D Gauss-Markov & Waypoint mobility
    - 6-DOF aerodynamic drag & downwash interaction via DronePhysicsEngine
    - Soft-kill EW reaction behavior (failsafe hover lock / forced descent)
    """

    def __init__(self, physics_engine: DronePhysicsEngine | None = None, dt: float = 0.05):
        self.dt = dt
        self.physics = physics_engine if physics_engine is not None else DronePhysicsEngine()
        self.drones: dict[str, SwarmDrone] = {}
        self.wind_velocity = np.array([1.5, 0.5, 0.0])  # Mild environmental crosswind

    def initialize_default_scenario(self) -> None:
        """Initializes a tactical multi-drone swarm scenario attacking toward protected asset from 4 distinct quadrants."""
        self.drones.clear()

        # Drone 1 (Sector Alpha ~35° North-East): Fast lead scout, OcuSync 2.4 GHz
        self.add_drone(
            drone_id="UAV-ALPHA-01",
            initial_pos=np.array([1720.0, 1204.0, 140.0]),
            initial_vel=np.array([-11.5, -8.0, 0.0]),
            frequency_mhz=2437.0,
            rcs_mean=0.03,
            rotor_rpm=6200.0,
        )

        # Drone 2 (Sector Bravo ~125° North-West): Tactical autonomous wingman, MAVLink 915 MHz with active GNSS spoofing
        d2 = self.add_drone(
            drone_id="UAV-BRAVO-02",
            initial_pos=np.array([-1319.0, 1884.0, 160.0]),
            initial_vel=np.array([8.0, -11.5, 0.0]),
            frequency_mhz=915.0,
            rcs_mean=0.045,
            rotor_rpm=5400.0,
        )
        # GNSS spoofing: fake position 450m offset with anomalous C/N0 = 56.5 dB-Hz
        d2.spoofed_gnss_position = np.array([-1319.0 + 350.0, 1884.0 + 300.0, 280.0])
        d2.carrier_to_noise_db_hz = 56.5

        # Drone 3 (Sector Charlie ~310° South-East): High-speed FPV munition interceptor, ExpressLRS 868 MHz
        self.add_drone(
            drone_id="UAV-CHARLIE-03",
            initial_pos=np.array([1253.0, -1494.0, 110.0]),
            initial_vel=np.array([-10.0, 12.0, 0.0]),
            frequency_mhz=868.0,
            rcs_mean=0.015,
            rotor_rpm=7800.0,
        )

        # Drone 4 (Sector Delta ~220° South-West): Long-range loitering munition, LoRa 433 MHz
        self.add_drone(
            drone_id="UAV-DELTA-04",
            initial_pos=np.array([-1608.0, -1350.0, 130.0]),
            initial_vel=np.array([10.5, 8.8, 0.0]),
            frequency_mhz=433.0,
            rcs_mean=0.035,
            rotor_rpm=5500.0,
        )

    def spawn_multi_sector_swarm(self, count: int = 6) -> list[str]:
        """Dynamically injects a coordinated multi-sector drone raid attacking from all bearings."""
        azimuths_deg = [35.0, 90.0, 125.0, 180.0, 240.0, 310.0]
        distances = [2100.0, 2000.0, 2300.0, 2150.0, 2250.0, 1950.0]
        altitudes = [140.0, 120.0, 170.0, 150.0, 130.0, 110.0]
        protocols = [2437.0, 5800.0, 915.0, 2462.0, 433.0, 868.0]
        speeds = [12.0, 14.0, 11.0, 13.0, 10.0, 17.0]

        created_ids = []
        for i in range(min(count, len(azimuths_deg))):
            az_rad = np.deg2rad(azimuths_deg[i])
            r = distances[i]
            z = altitudes[i]
            px = r * np.cos(az_rad)
            py = r * np.sin(az_rad)
            speed = speeds[i]
            vx = -speed * np.cos(az_rad)
            vy = -speed * np.sin(az_rad)

            d_id = f"UAV-RAID-{i+1:02d}"
            d = self.add_drone(
                drone_id=d_id,
                initial_pos=np.array([px, py, z]),
                initial_vel=np.array([vx, vy, 0.0]),
                frequency_mhz=protocols[i],
                rcs_mean=0.025 + i * 0.005,
                rotor_rpm=5400.0 + i * 400.0,
            )
            if i == 2:  # Inject spoofing into raid drone 3
                d.spoofed_gnss_position = np.array([px + 400.0, py + 300.0, z + 100.0])
                d.carrier_to_noise_db_hz = 57.0
            created_ids.append(d_id)
        return created_ids

    def redirect_spoofed_drones(self, heading_offset_rad: float = np.deg2rad(130.0)) -> int:
        """Transmits deceptive ephemeris to deflect spoofed drones away from the protected zone."""
        redirected_count = 0
        for drone in self.drones.values():
            if drone.spoofed_gnss_position is not None:
                # Rotate velocity vector 130 degrees away from origin
                cos_a, sin_a = np.cos(heading_offset_rad), np.sin(heading_offset_rad)
                vx, vy = drone.velocity[0], drone.velocity[1]
                drone.velocity[0] = vx * cos_a - vy * sin_a
                drone.velocity[1] = vx * sin_a + vy * cos_a
                drone.link_state = "LINK_LOST"  # Causes drone to drift away
                redirected_count += 1
        return redirected_count

    def add_drone(
        self,
        drone_id: str,
        initial_pos: np.ndarray,
        initial_vel: np.ndarray,
        frequency_mhz: float = 2440.0,
        rcs_mean: float = 0.03,
        rotor_rpm: float = 5600.0,
    ) -> SwarmDrone:
        drone = SwarmDrone(
            drone_id=drone_id,
            position=initial_pos.copy().astype(float),
            velocity=initial_vel.copy().astype(float),
            frequency_mhz=frequency_mhz,
            rcs_mean=rcs_mean,
            rotor_rpm=rotor_rpm,
        )
        self.drones[drone_id] = drone
        return drone

    def update_drone_link_state(self, drone_id: str, new_state: str) -> None:
        if drone_id in self.drones:
            if self.drones[drone_id].link_state == "NEUTRALIZED":
                return
            self.drones[drone_id].link_state = new_state

    def step_simulation(self) -> list[dict[str, Any]]:
        """Advances swarm physics, applying Gauss-Markov drift or EW countermeasure state."""
        all_positions = [d.position for d in self.drones.values()]

        for drone in self.drones.values():
            if drone.link_state == "NEUTRALIZED":
                continue

            if drone.link_state == "FORCED_LANDING":
                # Descent at controlled rate until grounded
                cmd_accel = np.array([-drone.velocity[0] * 1.5, -drone.velocity[1] * 1.5, -3.0])
                if drone.position[2] <= 0.6:
                    drone.position[2] = 0.5
                    drone.velocity = np.zeros(3)
                    drone.link_state = "NEUTRALIZED"
                    drone.rf_transmitting = False
                    continue

            elif drone.link_state == "HOVER_LOCK":
                # Rapidly decelerate to zero horizontal velocity, maintain altitude
                cmd_accel = np.array([-drone.velocity[0] * 2.5, -drone.velocity[1] * 2.5, -drone.velocity[2] * 2.0])

            elif drone.link_state == "LINK_LOST":
                # Uncontrolled drift or loiter
                heading_err = np.array([np.random.normal(0, 0.5), np.random.normal(0, 0.5), 0.0])
                cmd_accel = -0.2 * drone.velocity + heading_err

            else:
                # NORMAL: Navigate towards origin (asset) with 3D Gauss-Markov perturbations
                to_target = -drone.position
                dist = np.linalg.norm(to_target)
                if dist > 50.0:
                    desired_dir = to_target / dist
                    desired_vel = desired_dir * drone.mean_speed
                else:
                    desired_vel = np.zeros(3)

                # Gauss-Markov update for velocity perturbation
                w_noise = np.random.normal(0, 1.2, size=3)
                cmd_accel = (desired_vel - drone.velocity) * 0.4 + w_noise * np.sqrt(1.0 - drone.alpha_gm**2)

            # Apply 6-DOF aerodynamics via physics engine
            other_pos = [p for p in all_positions if not np.array_equal(p, drone.position)]
            new_p, new_v, actual_a = self.physics.apply_kinematics_step(
                position=drone.position,
                velocity=drone.velocity,
                commanded_accel=cmd_accel,
                dt=self.dt,
                other_positions=other_pos,
                wind_velocity=self.wind_velocity,
            )

            drone.position = new_p
            drone.velocity = new_v
            drone.commanded_accel = actual_a

            # Update spoofed GNSS trajectory offset if active
            if drone.spoofed_gnss_position is not None:
                drone.spoofed_gnss_position += drone.velocity * self.dt

        return [d.to_dict() for d in self.drones.values()]
