import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import numpy as np
from fastapi.testclient import TestClient

from app.core.physics_engine import DronePhysicsEngine
from app.defense.rf_jammer import DirectionalRFJammer
from app.fusion.track_manager import (
    CHI2_GATE_2D_99,
    CHI2_GATE_4D_99,
    MultiTargetTrackManager,
)
from app.fusion.unscented_kalman_filter import (
    GarudaTargetUKF,
    hx_radar_3d,
    hx_rf_bearing,
    residual_z_radar,
    wrap_angle,
)
from app.main import app
from app.sensors.radar_3d import Radar3DSensor
from app.sensors.rf_direction_finder import CHI2_GATE_3D_999, RFDirectionFinder


def test_angle_wrapping():
    assert np.isclose(wrap_angle(np.pi + 0.1), -np.pi + 0.1)
    assert np.isclose(wrap_angle(-np.pi - 0.1), np.pi - 0.1)
    assert np.isclose(wrap_angle(0.0), 0.0)

    # Radar angle residual
    z1 = np.array([100.0, 3.14, 0.1, 5.0])
    z2 = np.array([100.0, -3.14, 0.1, 5.0])
    res = residual_z_radar(z1, z2)
    assert abs(res[1]) < 0.01  # Should wrap around 2pi smoothly


def test_ukf_prediction_and_radar_update():
    # Target starting at (1000, 1000, 100) with velocity (-10, -10, 0)
    init_state = np.array([1000.0, 1000.0, 100.0, -10.0, -10.0, 0.0, 0.0, 0.0, 0.0])
    ukf = GarudaTargetUKF(init_state, dt=0.05)

    x_pred, p_pred = ukf.predict(0.05)
    # Check CA transition: x = 1000 - 10*0.05 = 999.5
    assert np.isclose(x_pred[0], 999.5, atol=1e-3)
    assert np.isclose(x_pred[1], 999.5, atol=1e-3)
    # Check covariance symmetry
    assert np.allclose(p_pred, p_pred.T)

    # Perform radar update with true measurement
    z_true = hx_radar_3d(init_state)
    d_m2, _nu, _s = ukf.compute_radar_mahalanobis(z_true)
    assert d_m2 < CHI2_GATE_4D_99

    ukf.update_radar(z_true)
    assert np.allclose(ukf.covariance, ukf.covariance.T)
    # Posterior covariance trace should be smaller than prior
    assert np.trace(ukf.covariance[0:3, 0:3]) < np.trace(p_pred[0:3, 0:3])


def test_ukf_rf_lob_sequential_update():
    init_state = np.array([1500.0, 1500.0, 120.0, -12.0, -12.0, 0.0, 0.0, 0.0, 0.0])
    ukf = GarudaTargetUKF(init_state, dt=0.05)
    ukf.predict()

    z_rf = hx_rf_bearing(init_state)
    d_m2 = ukf.update_rf_lob(z_rf)
    assert d_m2 < CHI2_GATE_2D_99
    assert np.allclose(ukf.covariance, ukf.covariance.T)


def test_track_manager_lifecycle():
    tm = MultiTargetTrackManager(dt=0.05)
    det1 = {
        "range_m": 1200.0,
        "az_rad": 0.5,
        "el_rad": 0.1,
        "doppler_mps": -15.0,
        "micro_doppler_hz": 1200.0,
    }

    # Scan 1: Spawns TENTATIVE track
    tm.step_fusion([det1], [])
    assert len(tm.tracks) == 1
    t = next(iter(tm.tracks.values()))
    assert t.status == "TENTATIVE"
    assert t.classification == "HOSTILE_QUADCOPTER"

    # Scan 2: Hit
    tm.step_fusion([det1], [])
    assert t.status == "TENTATIVE"

    # Scan 3: Hit -> Should transition to CONFIRMED (3 hits in window)
    tm.step_fusion([det1], [])
    assert t.status == "CONFIRMED"

    # Now simulate 5 consecutive misses -> Should be deleted
    for _ in range(5):
        tm.step_fusion([], [])
    assert len(tm.tracks) == 0


def test_radar_physics_swerling_and_micro_doppler():
    radar = Radar3DSensor(fc_hz=10.0e9)

    # 1. Swerling 1 RCS distribution
    samples = [radar.sample_swerling_1_rcs(0.03) for _ in range(1000)]
    assert np.isclose(np.mean(samples), 0.03, atol=0.01)

    # 2. SNR decreases with range^4
    snr_100m = radar.compute_snr_linear(100.0, 0.03)
    snr_200m = radar.compute_snr_linear(200.0, 0.03)
    ratio = snr_100m / snr_200m
    assert np.isclose(ratio, 16.0, rtol=0.1)  # (200/100)^4 = 16

    # 3. Micro-Doppler distinction
    f_md_drone = radar.compute_rotor_micro_doppler(el_rad=0.1, is_drone=True, rpm=5400.0)
    assert f_md_drone > 600.0

    f_md_avian = radar.compute_rotor_micro_doppler(el_rad=0.1, is_drone=False)
    assert f_md_avian < 60.0


def test_rf_direction_finder_and_gnss_spoofing():
    rf = RFDirectionFinder()

    # 1. Protocol classification
    prot, _threat = rf.classify_protocol(2440.0)
    assert prot == "DJI_OCUSYNC_4"

    prot_mav, _ = rf.classify_protocol(915.0)
    assert prot_mav == "MAVLINK_TELEMETRY_SIK"

    # 2. Root-MUSIC DoA estimation across forward and rear quadrants
    true_az = np.deg2rad(30.0)
    est_az = rf.estimate_root_music_doa(true_az, num_snapshots=128, snr_db=20.0)
    assert np.isclose(est_az, true_az, atol=np.deg2rad(4.0))

    true_az_rear = np.deg2rad(140.0)
    est_az_rear = rf.estimate_root_music_doa(true_az_rear, num_snapshots=128, snr_db=20.0)
    assert np.isclose(est_az_rear, true_az_rear, atol=np.deg2rad(4.0))

    # 3. Cross-modal GNSS spoofing test
    fused_pos = np.array([1000.0, 1000.0, 100.0])
    p_cov = np.eye(9) * 4.0

    # Case A: Nominal matching GPS, normal C/N0
    is_sp_a, _gamma_a = rf.evaluate_gnss_cross_modal_residual(
        gnss_pos=np.array([1001.0, 999.0, 101.0]),
        fused_pos=fused_pos,
        fused_p_cov=p_cov,
        carrier_to_noise=42.0,
    )
    assert not is_sp_a

    # Case B: Spoofed GPS 400m away, anomalous C/N0 = 56 dB-Hz
    is_sp_b, gamma_b = rf.evaluate_gnss_cross_modal_residual(
        gnss_pos=np.array([1400.0, 1000.0, 100.0]),
        fused_pos=fused_pos,
        fused_p_cov=p_cov,
        carrier_to_noise=56.0,
    )
    assert is_sp_b
    assert gamma_b > CHI2_GATE_3D_999


def test_physics_drag_and_downwash():
    engine = DronePhysicsEngine()

    # Parasitic drag opposes velocity
    v = np.array([20.0, 0.0, 0.0])
    a_drag = engine.compute_parasitic_drag_accel(v)
    assert a_drag[0] < 0.0
    assert np.isclose(a_drag[1], 0.0)

    # Downwash wake from drone directly above
    p_lower = np.array([100.0, 100.0, 50.0])
    p_upper = np.array([100.05, 100.05, 52.0])  # 2m higher
    w_downwash = engine.compute_downwash_deficit(p_lower, [p_upper])
    assert w_downwash > 0.5


def test_directional_rf_jammer_soft_kill():
    jammer = DirectionalRFJammer(default_power_w=80.0)
    drone_pos = np.array([500.0, 0.0, 100.0])

    # Unactivated: Normal link
    res_idle = jammer.evaluate_jamming_on_drone("UAV-01", drone_pos)
    assert res_idle.link_state == "NORMAL"
    assert res_idle.per < 0.01

    # Aim and activate jammer directly at drone
    az = float(np.arctan2(0.0, 500.0))  # 0.0 rad
    el = float(np.arcsin(100.0 / np.linalg.norm(drone_pos)))
    jammer.activate_directional_jammer(azimuth_rad=az, elevation_rad=el, power_w=100.0)

    # Sustained jamming over 2.0 seconds (40 frames at 20 Hz) to test progressive link degradation
    for _ in range(40):
        res_jammed = jammer.evaluate_jamming_on_drone("UAV-01", drone_pos, dt=0.05)

    assert res_jammed.j_to_s_db > 10.0
    assert res_jammed.sinr_db < 0.0
    assert res_jammed.per > 0.8
    assert res_jammed.link_state in ("FORCED_LANDING", "HOVER_LOCK")


def test_fastapi_rest_endpoints():
    client = TestClient(app)

    # Health check
    res_health = client.get("/api/v1/health")
    assert res_health.status_code == 200
    data = res_health.json()
    assert data["status"] == "HEALTHY"

    # Jammer activate
    res_jam = client.post("/api/v1/defense/jam", json={
        "azimuth_deg": 45.0,
        "elevation_deg": 15.0,
        "power_w": 75.0,
        "frequency_mhz": 2440.0,
        "bandwidth_mhz": 40.0,
    })
    assert res_jam.status_code == 200
    assert res_jam.json()["status"] == "ACTIVE"

    # Status
    res_status = client.get("/api/v1/defense/status")
    assert res_status.status_code == 200
    assert res_status.json()["is_active"] is True

    # Disarm
    res_disarm = client.post("/api/v1/defense/disarm")
    assert res_disarm.status_code == 200
    assert res_disarm.json()["status"] == "STANDBY"


def test_stonesoup_data_associator():
    from app.fusion.associator import StoneSoupGNNDataAssociator
    from app.fusion.track_manager import TrackRecord
    from app.fusion.unscented_kalman_filter import GarudaTargetUKF, hx_radar_3d

    associator = StoneSoupGNNDataAssociator()
    init_state = np.array([1200.0, 800.0, 100.0, -10.0, -5.0, 0.0, 0.0, 0.0, 0.0])
    trk = TrackRecord(track_id="TRK-999", ukf=GarudaTargetUKF(init_state))
    trk.ukf.predict()

    # Test conversion to Stone-Soup GaussianState
    gs = trk.to_stonesoup_state()
    assert gs.state_vector.shape == (9, 1)
    assert np.isclose(gs.state_vector[0, 0], trk.ukf.x[0])

    # Test detection conversion using true measurement
    z_true = hx_radar_3d(trk.ukf.x)
    det = {
        "range_m": float(z_true[0]),
        "az_rad": float(z_true[1]),
        "el_rad": float(z_true[2]),
        "doppler_mps": float(z_true[3]),
    }
    ss_det = associator.detection_dict_to_stonesoup(det)
    assert ss_det.state_vector.shape == (4, 1)

    # Test 2D GNN association
    matches, unmatched = associator.associate([trk], [det])
    assert 0 in matches
    assert matches[0] == 0
    assert len(unmatched) == 0

