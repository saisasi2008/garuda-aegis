from collections import deque
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy.optimize import linear_sum_assignment

from .unscented_kalman_filter import GarudaTargetUKF

CHI2_GATE_4D_99 = 13.277  # df=4, p=0.99
CHI2_GATE_2D_99 = 9.210   # df=2, p=0.99


@dataclass
class TrackRecord:
    track_id: str
    ukf: GarudaTargetUKF
    status: str = "TENTATIVE"  # TENTATIVE -> CONFIRMED -> DELETED
    hit_window: deque = field(default_factory=lambda: deque(maxlen=5))
    missed_scans: int = 0
    classification: str = "UNKNOWN"
    micro_doppler_hz: float = 0.0
    gnss_spoof_flag: bool = False
    ew_status: str = "MONITORING"  # MONITORING, JAMMING_ACTIVE, LINK_DISRUPTED, NEUTRALIZED
    link_sinr_db: float = 18.0
    packet_loss_pct: float = 0.0
    target_protocol: str = "DJI_OCUSYNC_4"
    last_updated: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        x = self.ukf.x
        cov_diag = np.diag(self.ukf.P)
        return {
            "track_id": self.track_id,
            "status": self.status,
            "classification": self.classification,
            "position": {
                "x": float(x[0]),
                "y": float(x[1]),
                "z": float(x[2]),
            },
            "velocity": {
                "vx": float(x[3]),
                "vy": float(x[4]),
                "vz": float(x[5]),
                "speed_mps": float(np.sqrt(x[3]**2 + x[4]**2 + x[5]**2)),
            },
            "acceleration": {
                "ax": float(x[6]),
                "ay": float(x[7]),
                "az": float(x[8]),
            },
            "uncertainty_pos_m": float(np.sqrt(max(cov_diag[0] + cov_diag[1] + cov_diag[2], 0.0))),
            "micro_doppler_hz": float(self.micro_doppler_hz),
            "gnss_spoof_flag": bool(self.gnss_spoof_flag),
            "ew_status": self.ew_status,
            "link_sinr_db": float(self.link_sinr_db),
            "packet_loss_pct": float(self.packet_loss_pct),
            "protocol": self.target_protocol,
            "missed_scans": int(self.missed_scans),
            "hits_in_window": int(sum(self.hit_window)),
        }

    def to_stonesoup_state(self):
        """Converts UKF state to Stone-Soup GaussianState object."""
        from .associator import StoneSoupGNNDataAssociator
        associator = StoneSoupGNNDataAssociator()
        return associator.ukf_to_gaussian_state(self.ukf.x, self.ukf.P)


class MultiTargetTrackManager:
    """Implements Mahalanobis Chi-Square gating, Hungarian GNN, and M-of-N (3/5) track management."""

    def __init__(self, dt: float = 0.05):
        self.dt = dt
        self.tracks: dict[str, TrackRecord] = {}
        self._next_id = 1
        from .associator import StoneSoupGNNDataAssociator
        self.associator = StoneSoupGNNDataAssociator(chi2_gate=CHI2_GATE_4D_99)

    def step_fusion(
        self,
        radar_detections: list[dict[str, Any]],
        rf_bearings: list[dict[str, Any]],
        current_time: float = 0.0,
    ) -> list[TrackRecord]:
        # 1. Predict all existing tracks forward
        track_list = list(self.tracks.values())
        for trk in track_list:
            trk.ukf.predict(self.dt)

        # 2. Build Penalized Mahalanobis Cost Matrix (N_tracks x N_detections)
        n_t = len(track_list)
        n_d = len(radar_detections)
        cost_matrix = np.full((n_t, n_d), 1e9, dtype=float)

        for i, trk in enumerate(track_list):
            for j, det in enumerate(radar_detections):
                z_vec = np.array([det["range_m"], det["az_rad"], det["el_rad"], det["doppler_mps"]])
                d_m2, _, S = trk.ukf.compute_radar_mahalanobis(z_vec)
                if d_m2 <= CHI2_GATE_4D_99:
                    sign, log_det_s = np.linalg.slogdet(S)
                    log_det = float(log_det_s) if sign > 0 else 0.0
                    cost_matrix[i, j] = d_m2 + max(0.0, log_det)

        # 3. Solve Global Nearest Neighbour (GNN) via Hungarian Algorithm
        matched_tracks: set[int] = set()
        matched_dets: set[int] = set()
        if n_t > 0 and n_d > 0:
            row_ind, col_ind = linear_sum_assignment(cost_matrix)
            for r_idx, c_idx in zip(row_ind, col_ind):
                if cost_matrix[r_idx, c_idx] < 1e8:
                    matched_tracks.add(r_idx)
                    matched_dets.add(c_idx)
                    trk = track_list[r_idx]
                    det = radar_detections[c_idx]
                    z_vec = np.array([det["range_m"], det["az_rad"], det["el_rad"], det["doppler_mps"]])
                    trk.ukf.update_radar(z_vec)
                    trk.hit_window.append(1)
                    trk.missed_scans = 0
                    trk.last_updated = current_time
                    trk.micro_doppler_hz = det.get("micro_doppler_hz", 0.0)
                    trk.classification = (
                        "HOSTILE_QUADCOPTER" if trk.micro_doppler_hz > 600.0 else "AVIAN_CLUTTER"
                    )

        # 4. Handle missed tracks and M-of-N lifecycle transitions
        tracks_to_delete = []
        for i, trk in enumerate(track_list):
            if i not in matched_tracks:
                trk.hit_window.append(0)
                trk.missed_scans += 1
            if trk.status == "TENTATIVE" and sum(trk.hit_window) >= 3:
                trk.status = "CONFIRMED"
            if trk.missed_scans >= 5 or (trk.status == "TENTATIVE" and len(trk.hit_window) == 5 and sum(trk.hit_window) < 2):
                trk.status = "DELETED"
                tracks_to_delete.append(trk.track_id)

        for t_id in tracks_to_delete:
            if t_id in self.tracks:
                del self.tracks[t_id]

        # 5. Spawn new TENTATIVE tracks for unassociated radar detections
        for j, det in enumerate(radar_detections):
            if j not in matched_dets:
                r, az, el, r_dot = det["range_m"], det["az_rad"], det["el_rad"], det["doppler_mps"]
                px = r * np.cos(el) * np.cos(az)
                py = r * np.cos(el) * np.sin(az)
                pz = r * np.sin(el)
                vx = r_dot * np.cos(el) * np.cos(az)
                vy = r_dot * np.cos(el) * np.sin(az)
                vz = r_dot * np.sin(el)
                init_x = np.array([px, py, pz, vx, vy, vz, 0.0, 0.0, 0.0])
                t_id = f"TRK-{self._next_id:03d}"
                self._next_id += 1
                new_trk = TrackRecord(
                    track_id=t_id,
                    ukf=GarudaTargetUKF(init_x, self.dt),
                    last_updated=current_time,
                )
                new_trk.hit_window.append(1)
                new_trk.micro_doppler_hz = det.get("micro_doppler_hz", 0.0)
                new_trk.classification = (
                    "HOSTILE_QUADCOPTER" if new_trk.micro_doppler_hz > 600.0 else "AVIAN_CLUTTER"
                )
                self.tracks[t_id] = new_trk

        # 6. Fuse Passive RF Direction-Finder LOBs into active tracks via Nearest Neighbor gating
        claimed_track_ids: set[str] = set()
        for rf in rf_bearings:
            z_rf = np.array([rf["az_rad"], rf["el_rad"]])
            sensor_pos = np.array(rf.get("sensor_pos", [0.0, 0.0, 0.0]))
            best_trk = None
            min_d_rf = CHI2_GATE_2D_99
            for trk in self.tracks.values():
                if trk.track_id in claimed_track_ids:
                    continue
                d_rf, _, _, _ = trk.ukf.compute_rf_mahalanobis(z_rf, sensor_pos=sensor_pos)
                if d_rf <= min_d_rf:
                    min_d_rf = d_rf
                    best_trk = trk

            if best_trk is not None:
                claimed_track_ids.add(best_trk.track_id)
                best_trk.ukf.update_rf_lob(z_rf, sensor_pos=sensor_pos)
                if rf.get("gnss_spoof_flag", False):
                    best_trk.gnss_spoof_flag = True
                if "protocol" in rf:
                    best_trk.target_protocol = rf["protocol"]

        return [t for t in self.tracks.values() if t.status == "CONFIRMED"]
