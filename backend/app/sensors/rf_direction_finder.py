from dataclasses import dataclass, field
from typing import Any, ClassVar

import numpy as np
from scipy import linalg

CHI2_GATE_3D_999 = 16.266  # Chi-square df=3, p=0.999


@dataclass
class RFBearingDetection:
    az_rad: float
    el_rad: float
    frequency_mhz: float
    protocol: str
    threat_category: str
    gnss_spoof_flag: bool = False
    spoof_gamma: float = 0.0
    cn0_db_hz: float = 42.0
    sensor_pos: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])
    drone_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "az_rad": float(self.az_rad),
            "el_rad": float(self.el_rad),
            "frequency_mhz": float(self.frequency_mhz),
            "protocol": self.protocol,
            "threat_category": self.threat_category,
            "gnss_spoof_flag": bool(self.gnss_spoof_flag),
            "spoof_gamma": float(self.spoof_gamma),
            "cn0_db_hz": float(self.cn0_db_hz),
            "sensor_pos": self.sensor_pos,
            "drone_id": self.drone_id,
        }


class RFDirectionFinder:
    """
    Passive RF Direction Finder & Protocol Interceptor:
    - DJI OcuSync / MAVLink / ExpressLRS protocol fingerprinting
    - Root-MUSIC subspace super-resolution Direction of Arrival (DoA)
    - Cross-modal statistical GNSS spoofing detector (innovation residual chi^2 > 16.266 + C/N0 delta)
    """

    PROTOCOL_BANDS: ClassVar[dict[tuple[float, float], dict[str, str]]] = {
        (2400.0, 2483.5): {"protocol": "DJI_OCUSYNC_4", "threat": "HIGH_END_CONSUMER_OR_RECON"},
        (5725.0, 5850.0): {"protocol": "DJI_OCUSYNC_5G", "threat": "LONG_RANGE_HD_VIDEO_DOWNLINK"},
        (902.0, 928.0):   {"protocol": "MAVLINK_TELEMETRY_SIK", "threat": "AUTONOMOUS_TACTICAL_UAV"},
        (868.0, 870.0):   {"protocol": "EXPRESS_LRS_LONG_RANGE", "threat": "HIGH_SPEED_FPV_INTERCEPT"},
        (433.0, 434.7):   {"protocol": "LORA_TELEMETRY_UAV", "threat": "LONG_RANGE_LOITERING_MUNITION"},
    }

    def __init__(
        self,
        num_elements: int = 8,
        element_spacing_ratio: float = 0.5,  # d / lambda
        sensor_position: np.ndarray | None = None,
        nominal_cn0: float = 43.0,
    ):
        self.m_elements = num_elements
        self.d_ratio = element_spacing_ratio
        self.sensor_pos = np.zeros(3) if sensor_position is None else np.asarray(sensor_position)
        self.nominal_cn0 = nominal_cn0
        self.r_gnss = np.diag([3.0**2, 3.0**2, 5.0**2])  # 3D GNSS measurement noise covariance

    def classify_protocol(self, freq_mhz: float) -> tuple[str, str]:
        for (f_min, f_max), meta in self.PROTOCOL_BANDS.items():
            if f_min <= freq_mhz <= f_max:
                return meta["protocol"], meta["threat"]
        return "UNKNOWN_RF_EMITTER", "UNIDENTIFIED"

    def estimate_root_music_doa(
        self,
        true_azimuth_rad: float,
        num_snapshots: int = 128,
        snr_db: float = 15.0,
    ) -> float:
        """
        Computes 1D Root-MUSIC angle of arrival over Uniform Linear Array:
        X = a(theta) s + N
        R_xx = 1/K * X * X^H = U_s Lambda_s U_s^H + U_n Lambda_n U_n^H
        """
        # Steering vector a(theta) = [1, e^(j*2*pi*d/lambda*sin(theta)), ...]
        m = self.m_elements
        d = self.d_ratio
        phase_shift = 2.0 * np.pi * d * np.sin(true_azimuth_rad)
        steering = np.exp(1j * np.arange(m) * phase_shift).reshape((m, 1))

        # Generate signal snapshots
        signal_power = 10.0 ** (snr_db / 10.0)
        s = np.sqrt(signal_power / 2.0) * (
            np.random.normal(size=(1, num_snapshots)) + 1j * np.random.normal(size=(1, num_snapshots))
        )
        noise = (1.0 / np.sqrt(2.0)) * (
            np.random.normal(size=(m, num_snapshots)) + 1j * np.random.normal(size=(m, num_snapshots))
        )
        x = steering @ s + noise

        # Sample covariance matrix
        r_xx = (x @ x.conj().T) / num_snapshots

        # Eigendecomposition
        eigvals, eigvecs = linalg.eigh(r_xx)
        # Sort descending
        idx = np.argsort(eigvals)[::-1]
        eigvecs = eigvecs[:, idx]

        # Noise subspace Un (columns 1 to m-1 for 1 source)
        u_n = eigvecs[:, 1:]
        c_mat = u_n @ u_n.conj().T

        # Polynomial coefficients for Root-MUSIC: p(z) = sum_{k=-(m-1)}^{m-1} c_k z^k
        # Extract diagonal sums of C matrix
        poly_coeffs = np.zeros(2 * m - 1, dtype=complex)
        for diag_idx in range(-(m - 1), m):
            poly_coeffs[diag_idx + m - 1] = np.sum(np.diagonal(c_mat, offset=diag_idx))

        roots = np.roots(poly_coeffs[::-1])
        # Find roots strictly inside unit circle and closest to it
        inside_roots = roots[np.abs(roots) < 1.0]
        if len(inside_roots) == 0:
            return float(true_azimuth_rad + np.random.normal(0, np.deg2rad(1.5)))

        best_root = inside_roots[np.argmax(np.abs(inside_roots))]
        angle = np.angle(best_root)
        sin_theta = angle / (2.0 * np.pi * d)
        sin_theta = np.clip(sin_theta, -0.9999, 0.9999)
        est_az = float(np.arcsin(sin_theta))

        # Disambiguate back hemisphere (quadrants 2 and 3)
        if np.cos(true_azimuth_rad) < 0:
            if true_azimuth_rad > 0:
                est_az = np.pi - est_az
            else:
                est_az = -np.pi - est_az

        # Circular wrap to [-pi, pi]
        return float((est_az + np.pi) % (2.0 * np.pi) - np.pi)

    def evaluate_gnss_cross_modal_residual(
        self,
        gnss_pos: np.ndarray,
        fused_pos: np.ndarray,
        fused_p_cov: np.ndarray,
        carrier_to_noise: float,
    ) -> tuple[bool, float]:
        """
        Cross-Modal Spoofing Residual:
        gamma_spoof = (p_GNSS - p_hat)^T (P_pos + R_GNSS)^(-1) (p_GNSS - p_hat)
        Trigger GNSS_SPOOF_CONFIRMED if gamma_spoof > chi2(3, 0.999)=16.266 AND delta C/N0 > 6 dB-Hz
        """
        p_pos = fused_p_cov[0:3, 0:3]
        s_cov = p_pos + self.r_gnss
        diff = gnss_pos - fused_pos

        try:
            gamma = float(diff.T @ np.linalg.solve(s_cov, diff))
        except np.linalg.LinAlgError:
            gamma = 0.0

        delta_cn0 = carrier_to_noise - self.nominal_cn0
        is_spoofed = (gamma > CHI2_GATE_3D_999) and (delta_cn0 > 6.0)

        return is_spoofed, gamma

    def intercept_emissions(
        self,
        true_drones: list[dict[str, Any]],
        fused_tracks: dict[str, Any] | None = None,
    ) -> list[RFBearingDetection]:
        """
        Intercepts active RF telemetry emissions, applies Root-MUSIC DoA,
        and runs cross-modal GNSS spoofing validation.
        """
        bearings: list[RFBearingDetection] = []

        for drone in true_drones:
            # Check if drone has active RF transmission
            if not drone.get("rf_transmitting", True):
                continue

            pos = np.asarray(drone["position"]) - self.sensor_pos
            r = float(np.linalg.norm(pos))
            if r < 10.0 or r > 10000.0:
                continue

            true_az = float(np.arctan2(pos[1], pos[0]))
            true_el = float(np.arcsin(np.clip(pos[2] / r, -1.0, 1.0)))

            freq_mhz = drone.get("frequency_mhz", 2440.0)
            protocol, threat = self.classify_protocol(freq_mhz)

            # High-resolution bearing from Root-MUSIC
            doa_az = self.estimate_root_music_doa(true_az)
            doa_el = float(np.clip(true_el + np.random.normal(0, np.deg2rad(1.8)), -np.pi / 2.0, np.pi / 2.0))

            # Evaluate GNSS spoofing status
            cn0 = drone.get("carrier_to_noise_db_hz", 42.0)
            spoofed_flag = False
            gamma_val = 0.0

            # If drone is reporting spoofed GNSS coordinates
            spoof_coord = drone.get("spoofed_gnss_position")
            if spoof_coord is None:
                spoof_coord = drone.get("spoofed_gnss")

            if spoof_coord is not None and fused_tracks:
                # Look up corresponding fused track
                for trk in fused_tracks.values():
                    trk_pos = trk.ukf.position
                    if np.linalg.norm(trk_pos - drone["position"]) < 350.0:
                        is_sp, gamma = self.evaluate_gnss_cross_modal_residual(
                            gnss_pos=np.asarray(spoof_coord),
                            fused_pos=trk_pos,
                            fused_p_cov=trk.ukf.covariance,
                            carrier_to_noise=cn0,
                        )
                        spoofed_flag = is_sp
                        gamma_val = gamma
                        break

            bearings.append(
                RFBearingDetection(
                    az_rad=doa_az,
                    el_rad=doa_el,
                    frequency_mhz=freq_mhz,
                    protocol=protocol,
                    threat_category=threat,
                    gnss_spoof_flag=spoofed_flag,
                    spoof_gamma=gamma_val,
                    cn0_db_hz=cn0,
                    sensor_pos=list(self.sensor_pos),
                    drone_id=drone.get("drone_id"),
                )
            )

        return bearings
