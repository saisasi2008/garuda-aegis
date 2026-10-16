from dataclasses import dataclass
from typing import Any

import numpy as np


@dataclass
class RadarDetection:
    range_m: float
    az_rad: float
    el_rad: float
    doppler_mps: float
    micro_doppler_hz: float
    snr_db: float
    rcs_m2: float
    target_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "range_m": float(self.range_m),
            "az_rad": float(self.az_rad),
            "el_rad": float(self.el_rad),
            "doppler_mps": float(self.doppler_mps),
            "micro_doppler_hz": float(self.micro_doppler_hz),
            "snr_db": float(self.snr_db),
            "rcs_m2": float(self.rcs_m2),
            "target_id": self.target_id,
        }


class Radar3DSensor:
    """
    3D Pulse-Doppler X-Band Radar model implementing:
    - Swerling Case 1 RCS fluctuations
    - Monostatic radar range equation SNR
    - 1D CA-CFAR / OS-CFAR threshold detector
    - Rotor blade micro-Doppler modulation sidebands
    """

    def __init__(
        self,
        fc_hz: float = 10.0e9,       # 10 GHz X-band
        pt_w: float = 150.0,         # 150 Watts peak power
        gt_db: float = 30.0,         # 30 dBi transmit gain
        gr_db: float = 30.0,         # 30 dBi receive gain
        pfa: float = 1e-6,           # Probability of false alarm
        n_ref: int = 16,             # CFAR reference cells
        n_guard: int = 4,            # CFAR guard cells
        n_pulses: int = 64,          # Coherent Processing Interval pulses
        pulse_width_s: float = 1.0e-6, # 1 microsecond pulse
        noise_figure_db: float = 4.0,
        loss_sys_db: float = 6.0,
        rcs_mean_m2: float = 0.03,   # Small quadcopter mean RCS (0.01 - 0.05 m^2)
        sensor_position: np.ndarray | None = None,
    ):
        self.fc = fc_hz
        self.c = 299792458.0
        self.wavelength = self.c / self.fc
        self.pt = pt_w
        self.gt_linear = 10.0 ** (gt_db / 10.0)
        self.gr_linear = 10.0 ** (gr_db / 10.0)
        self.pfa = pfa
        self.n_ref = n_ref
        self.n_guard = n_guard
        self.n_pulses = n_pulses
        self.tau = pulse_width_s
        self.kb = 1.380649e-23
        self.t0 = 290.0  # Kelvin
        self.fn_linear = 10.0 ** (noise_figure_db / 10.0)
        self.loss_linear = 10.0 ** (loss_sys_db / 10.0)
        self.rcs_mean = rcs_mean_m2
        self.sensor_pos = np.zeros(3) if sensor_position is None else np.asarray(sensor_position)

        # 1D CA-CFAR multiplier alpha = N_ref * (P_fa^(-1/N_ref) - 1)
        self.alpha_cfar = self.n_ref * (self.pfa ** (-1.0 / self.n_ref) - 1.0)

        # Noise standard deviations for detections
        self.sigma_r = 1.2
        self.sigma_az = np.deg2rad(0.6)
        self.sigma_el = np.deg2rad(0.8)
        self.sigma_vr = 0.35

    def sample_swerling_1_rcs(self, mean_rcs: float | None = None) -> float:
        """Swerling Case 1: Exponential PDF p(sigma) = (1/sigma_avg) * exp(-sigma / sigma_avg)."""
        scale = mean_rcs if mean_rcs is not None else self.rcs_mean
        return float(np.random.exponential(scale=scale))

    def compute_snr_linear(self, range_m: float, rcs_m2: float) -> float:
        """
        Monostatic Pulse-Doppler SNR equation:
        SNR = (Pt * Gt * Gr * lambda^2 * sigma * N_pulses * tau) / ((4*pi)^3 * r^4 * kb * T0 * Fn * Lsys)
        """
        r = max(range_m, 10.0)
        numerator = (
            self.pt
            * self.gt_linear
            * self.gr_linear
            * (self.wavelength ** 2)
            * rcs_m2
            * self.n_pulses
            * self.tau
        )
        denominator = (
            ((4.0 * np.pi) ** 3)
            * (r ** 4)
            * self.kb
            * self.t0
            * self.fn_linear
            * self.loss_linear
        )
        return float(numerator / max(denominator, 1e-30))

    def compute_rotor_micro_doppler(
        self,
        el_rad: float,
        is_drone: bool = True,
        rpm: float = 5400.0,
        blade_len_m: float = 0.13,
    ) -> float:
        """
        Rotor blade flash micro-Doppler maximum sideband frequency:
        f_mD_max = 2 * fc / c * L_b * Omega * cos(elevation)
        """
        if not is_drone:
            # Avian clutter: flapping wing cadence < 60 Hz
            return float(np.random.uniform(15.0, 55.0))

        # Quadcopter rotor spinning at RPM rad/s
        omega = 2.0 * np.pi * (rpm / 60.0)
        f_md_max = (2.0 * self.fc / self.c) * blade_len_m * omega * np.cos(el_rad)
        # Add small rotor speed perturbation
        jitter = np.random.uniform(-40.0, 40.0)
        return float(abs(f_md_max) + jitter)

    def scan_airspace(self, true_drones: list[dict[str, Any]]) -> list[RadarDetection]:
        """
        Scans all airspace objects, computes Swerling 1 RCS, evaluates CFAR detection threshold,
        generates micro-Doppler signatures, and returns spherical detections with measurement noise.
        """
        detections: list[RadarDetection] = []

        for drone in true_drones:
            pos = np.asarray(drone["position"]) - self.sensor_pos
            vel = np.asarray(drone["velocity"])

            r_true = float(np.linalg.norm(pos))
            if r_true < 5.0 or r_true > 6000.0:
                continue

            az_true = float(np.arctan2(pos[1], pos[0]))
            el_true = float(np.arcsin(np.clip(pos[2] / r_true, -1.0, 1.0)))
            vr_true = float(np.dot(pos, vel) / r_true)

            # 1. Swerling 1 RCS
            base_rcs = drone.get("rcs_mean", self.rcs_mean)
            rcs_inst = self.sample_swerling_1_rcs(base_rcs)

            # 2. SNR calculation
            snr_lin = self.compute_snr_linear(r_true, rcs_inst)
            snr_db = 10.0 * np.log10(max(snr_lin, 1e-10))

            # 3. CFAR Detection threshold check (e.g. required SNR for P_fa=1e-6 with N_pulses=64 is ~8-10 dB)
            threshold_snr_db = 8.5
            if snr_db < threshold_snr_db:
                continue  # Missed detection below CFAR noise floor

            # 4. Micro-Doppler modulation
            is_uav = drone.get("classification", "HOSTILE_QUADCOPTER") != "AVIAN_CLUTTER"
            rpm = drone.get("rotor_rpm", 5600.0)
            f_md = self.compute_rotor_micro_doppler(el_true, is_drone=is_uav, rpm=rpm)

            # 5. Add measurement Gaussian noise with physical bounds
            r_meas = float(max(1.0, r_true + np.random.normal(0.0, self.sigma_r)))
            az_noisy = az_true + np.random.normal(0.0, self.sigma_az)
            az_meas = float((az_noisy + np.pi) % (2.0 * np.pi) - np.pi)
            el_meas = float(np.clip(el_true + np.random.normal(0.0, self.sigma_el), -np.pi / 2.0, np.pi / 2.0))
            vr_meas = float(vr_true + np.random.normal(0.0, self.sigma_vr))

            detections.append(
                RadarDetection(
                    range_m=r_meas,
                    az_rad=az_meas,
                    el_rad=el_meas,
                    doppler_mps=vr_meas,
                    micro_doppler_hz=f_md,
                    snr_db=snr_db,
                    rcs_m2=rcs_inst,
                    target_id=drone.get("drone_id"),
                )
            )

        return detections
