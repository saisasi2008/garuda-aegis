from datetime import datetime, timezone
from typing import Any

import numpy as np
from scipy.optimize import linear_sum_assignment
from stonesoup.measures import Mahalanobis
from stonesoup.types.detection import Detection
from stonesoup.types.hypothesis import SingleDistanceHypothesis
from stonesoup.types.state import GaussianState


class StoneSoupGNNDataAssociator:
    """
    Stone-Soup Multi-Target Data Associator:
    - Converts UKF state dictionaries into Stone-Soup GaussianState objects.
    - Converts 4D radar detections into Stone-Soup Detection objects.
    - Solves Global Nearest Neighbour (GNN) via 2D assignment (Hungarian algorithm).
    - Applies Chi-Square Mahalanobis statistical gating (gate = 13.277 for df=4).
    """

    def __init__(self, chi2_gate: float = 13.277):
        self.chi2_gate = chi2_gate
        self.measure = Mahalanobis()

    def ukf_to_gaussian_state(
        self,
        x: np.ndarray,
        p: np.ndarray,
        timestamp: datetime | None = None,
    ) -> GaussianState:
        """Converts custom 9-state UKF state and covariance into Stone-Soup GaussianState."""
        ts = timestamp if timestamp is not None else datetime.now(timezone.utc)
        return GaussianState(
            state_vector=x.reshape((-1, 1)),
            covar=p,
            timestamp=ts,
        )

    def detection_dict_to_stonesoup(
        self,
        det: dict[str, Any],
        timestamp: datetime | None = None,
    ) -> Detection:
        """Converts radar detection dictionary [r, az, el, r_dot] into Stone-Soup Detection object."""
        ts = timestamp if timestamp is not None else datetime.now(timezone.utc)
        z_vec = np.array([
            det["range_m"],
            det["az_rad"],
            det["el_rad"],
            det["doppler_mps"],
        ]).reshape((-1, 1))
        return Detection(
            state_vector=z_vec,
            timestamp=ts,
            metadata=det,
        )

    def associate(
        self,
        tracks: list[Any],
        radar_detections: list[dict[str, Any]],
        dt_current: float = 0.05,
    ) -> tuple[dict[int, int], list[int]]:
        """
        Computes assignment between UKF tracks and radar detections.
        Returns:
            matches: dict mapping track_index -> detection_index
            unmatched_detections: list of unassociated detection indices
        """
        n_t = len(tracks)
        n_d = len(radar_detections)
        if n_t == 0:
            return {}, list(range(n_d))
        if n_d == 0:
            return {}, []

        # Build Mahalanobis distance hypotheses
        hypotheses: dict[int, list[SingleDistanceHypothesis]] = {}
        for trk_idx, trk in enumerate(tracks):
            hypotheses[trk_idx] = []
            for det_idx, det in enumerate(radar_detections):
                z_vec = np.array([det["range_m"], det["az_rad"], det["el_rad"], det["doppler_mps"]])
                d_m2, _, _s = trk.ukf.compute_radar_mahalanobis(z_vec)
                if d_m2 <= self.chi2_gate:
                    dist = float(np.sqrt(max(d_m2, 0.0)))
                    hypotheses[trk_idx].append(
                        SingleDistanceHypothesis(
                            prediction=None,
                            measurement=det_idx,
                            distance=dist,
                        )
                    )

        # Build cost matrix
        cost_mat = np.full((n_t, n_d), 1e9, dtype=float)
        for t_idx, hyps in hypotheses.items():
            for h in hyps:
                d_idx = h.measurement
                cost_mat[t_idx, d_idx] = h.distance

        matched_pairs: dict[int, int] = {}
        used_dets: set[int] = set()

        row_ind, col_ind = linear_sum_assignment(cost_mat)
        for r, c in zip(row_ind, col_ind):
            if cost_mat[r, c] < 1e8:
                matched_pairs[r] = c
                used_dets.add(c)

        unmatched_dets = [j for j in range(n_d) if j not in used_dets]
        return matched_pairs, unmatched_dets
