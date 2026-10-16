import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.main import (
    DT_TICK,
    radar_sensor,
    rf_jammer,
    rf_sensor,
    swarm_sim,
    track_manager,
)


def test_live_simulation_tick_progression():
    """Verifies that 20 Hz simulation ticks progress physics, sensors, and UKF/GNN fusion."""
    swarm_sim.initialize_default_scenario()
    track_manager.tracks.clear()

    # Step simulation 15 ticks (~0.75 seconds)
    for tick in range(15):
        # 1. Swarm kinematics
        ground_truth = swarm_sim.step_simulation()
        assert len(ground_truth) >= 3

        # 2. Sensors
        radar_dets = radar_sensor.scan_airspace(ground_truth)
        radar_dicts = [d.to_dict() for d in radar_dets]

        rf_bearings = rf_sensor.intercept_emissions(ground_truth, track_manager.tracks)
        rf_dicts = [b.to_dict() for b in rf_bearings]

        # 3. Fusion
        track_manager.step_fusion(radar_dicts, rf_dicts, current_time=tick * DT_TICK)

        # 4. Jammer impact check
        for drone in swarm_sim.drones.values():
            res = rf_jammer.evaluate_jamming_on_drone(drone.drone_id, drone.position)
            swarm_sim.update_drone_link_state(drone.drone_id, res.link_state)

    # After 15 ticks, tracks should be established and confirmed
    assert len(track_manager.tracks) >= 3
    confirmed_tracks = [t for t in track_manager.tracks.values() if t.status == "CONFIRMED"]
    assert len(confirmed_tracks) >= 2

    # Check that GNSS spoofing flag was detected on UAV-BRAVO-02
    spoofed_tracks = [t for t in track_manager.tracks.values() if t.gnss_spoof_flag]
    assert len(spoofed_tracks) >= 1

    # Activate jammer against one confirmed track
    target = confirmed_tracks[0]
    rf_jammer.activate_directional_jammer(
        azimuth_rad=0.5,
        elevation_rad=0.2,
        power_w=100.0,
        target_track_id=target.track_id,
    )

    # Step another 5 ticks with jammer active
    for tick in range(15, 20):
        ground_truth = swarm_sim.step_simulation()
        radar_dets = radar_sensor.scan_airspace(ground_truth)
        radar_dicts = [d.to_dict() for d in radar_dets]
        rf_bearings = rf_sensor.intercept_emissions(ground_truth, track_manager.tracks)
        rf_dicts = [b.to_dict() for b in rf_bearings]
        track_manager.step_fusion(radar_dicts, rf_dicts, current_time=tick * DT_TICK)

        for drone in swarm_sim.drones.values():
            res = rf_jammer.evaluate_jamming_on_drone(drone.drone_id, drone.position)
            swarm_sim.update_drone_link_state(drone.drone_id, res.link_state)

    # Verify jammer status is active
    assert rf_jammer.is_active is True
