from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.special import erfc


@dataclass
class JammingResult:
    drone_id: str
    sinr_db: float
    ber: float
    per: float
    link_state: str  # NORMAL, LINK_LOST, HOVER_LOCK, FORCED_LANDING
    j_to_s_db: float
    received_jammer_power_dbm: float
    received_signal_power_dbm: float


class DirectionalRFJammer:
    """
    Directional Electronic Warfare Countermeasure RF Jammer:
    - Off-axis antenna radiation pattern model: G_J(psi) = G_max - 12*(psi / theta_3dB)^2
    - Free-space path loss and J/S link budget
    - OFDM / QPSK Bit Error Rate (BER) and Packet Error Rate (PER)
    - UAV control link disruption state machine (LINK_LOST -> HOVER_LOCK -> FORCED_LANDING)
    """

    def __init__(
        self,
        jammer_pos: np.ndarray | None = None,
        g_max_dbi: float = 24.0,       # 24 dBi high-gain directional horn/patch array
        theta_3db_deg: float = 25.0,    # 25 degree half-power beamwidth
        default_power_w: float = 50.0,  # 50 Watts (47 dBm)
        eirp_gcs_dbm: float = 20.0,     # Friendly GCS 100 mW EIRP
        bandwidth_jammer_mhz: float = 40.0,
        bandwidth_signal_mhz: float = 20.0,
        l_pol_db: float = 3.0,          # Polarization mismatch loss
    ):
        self.jammer_pos = np.zeros(3) if jammer_pos is None else np.asarray(jammer_pos)
        self.g_max_dbi = g_max_dbi
        self.theta_3db_rad = np.deg2rad(theta_3db_deg)
        self.power_w = default_power_w
        self.eirp_gcs_dbm = eirp_gcs_dbm
        self.b_j_mhz = bandwidth_jammer_mhz
        self.b_sig_mhz = bandwidth_signal_mhz
        self.l_pol_db = l_pol_db
        self.c = 299792458.0
        self.kb = 1.380649e-23
        self.t0 = 290.0

        # Operational state
        self.is_active: bool = False
        self.aim_az_rad: float = 0.0
        self.aim_el_rad: float = 0.0
        self.freq_mhz: float = 2440.0
        self.target_track_id: str | None = None

    def activate_directional_jammer(
        self,
        azimuth_rad: float,
        elevation_rad: float,
        power_w: float | None = None,
        freq_mhz: float = 2440.0,
        bandwidth_mhz: float = 40.0,
        target_track_id: str | None = None,
    ) -> dict[str, Any]:
        self.is_active = True
        self.aim_az_rad = azimuth_rad
        self.aim_el_rad = elevation_rad
        if power_w is not None:
            self.power_w = power_w
        self.freq_mhz = freq_mhz
        self.b_j_mhz = bandwidth_mhz
        self.target_track_id = target_track_id

        return {
            "status": "ACTIVE",
            "azimuth_deg": float(np.rad2deg(self.aim_az_rad)),
            "elevation_deg": float(np.rad2deg(self.aim_el_rad)),
            "power_w": float(self.power_w),
            "freq_mhz": float(self.freq_mhz),
            "bandwidth_mhz": float(self.b_j_mhz),
            "target_track_id": self.target_track_id,
        }

    def deactivate_jammer(self) -> dict[str, Any]:
        self.is_active = False
        self.target_track_id = None
        return {"status": "STANDBY"}

    def compute_antenna_gain_dbi(self, target_az: float, target_el: float) -> float:
        """
        Directional antenna pattern with parabolic main lobe roll-off:
        G_J(delta_psi) = max(G_max - 12 * (delta_psi / theta_3dB)^2, -10 dBi)
        """
        # Spherical pointing vectors
        aim_vec = np.array([
            np.cos(self.aim_el_rad) * np.cos(self.aim_az_rad),
            np.cos(self.aim_el_rad) * np.sin(self.aim_az_rad),
            np.sin(self.aim_el_rad)
        ])
        tgt_vec = np.array([
            np.cos(target_el) * np.cos(target_az),
            np.cos(target_el) * np.sin(target_az),
            np.sin(target_el)
        ])
        cos_psi = np.clip(np.dot(aim_vec, tgt_vec), -1.0, 1.0)
        delta_psi = float(np.arccos(cos_psi))

        gain = self.g_max_dbi - 12.0 * ((delta_psi / self.theta_3db_rad) ** 2)
        return float(max(gain, -10.0))  # Back-lobe / side-lobe floor -10 dBi

    def evaluate_jamming_on_drone(
        self,
        drone_id: str,
        drone_pos: np.ndarray,
        gcs_pos: np.ndarray | None = None,
        packet_len_bits: int = 512,
    ) -> JammingResult:
        """
        Calculates J/S link budget, effective post-processing SINR, QPSK BER and PER:
        SINR_lin = P_S / (P_J + N0 * B_sig)
        BER = 0.5 * erfc(sqrt(SINR_lin))
        PER = 1 - (1 - BER)^L_pkt
        """
        g_pos = gcs_pos if gcs_pos is not None else np.array([2500.0, 2000.0, 0.0])
        pos_rel_j = drone_pos - self.jammer_pos
        d_j = max(float(np.linalg.norm(pos_rel_j)), 1.0)
        target_az = float(np.arctan2(pos_rel_j[1], pos_rel_j[0]))
        target_el = float(np.arcsin(np.clip(pos_rel_j[2] / d_j, -1.0, 1.0)))

        d_gcs = max(float(np.linalg.norm(drone_pos - g_pos)), 10.0)

        # Baseline GCS signal power calculation (Free-space path loss)
        lambda_m = self.c / (self.freq_mhz * 1e6)
        path_loss_gcs_db = 20.0 * np.log10(4.0 * np.pi * d_gcs / lambda_m)
        p_rx_signal_dbm = self.eirp_gcs_dbm - path_loss_gcs_db

        # Thermal noise floor P_N0 = k_B * T0 * B_sig
        p_noise_w = self.kb * self.t0 * (self.b_sig_mhz * 1e6)
        p_noise_dbm = 10.0 * np.log10(p_noise_w * 1e3)

        if not self.is_active:
            # Nominal unjammed link
            snr_lin = 10.0 ** ((p_rx_signal_dbm - p_noise_dbm) / 10.0)
            ber = float(0.5 * erfc(np.sqrt(max(snr_lin, 0.0))))
            per = float(1.0 - (1.0 - ber) ** packet_len_bits)
            return JammingResult(
                drone_id=drone_id,
                sinr_db=float(p_rx_signal_dbm - p_noise_dbm),
                ber=ber,
                per=per,
                link_state="NORMAL",
                j_to_s_db=-40.0,
                received_jammer_power_dbm=-120.0,
                received_signal_power_dbm=p_rx_signal_dbm,
            )

        # Jammer EIRP
        p_j_dbm = 10.0 * np.log10(self.power_w * 1e3)
        g_j_dbi = self.compute_antenna_gain_dbi(target_az, target_el)
        eirp_j_dbm = p_j_dbm + g_j_dbi

        # Jamming-to-Signal ratio (dB)
        # (J/S)_dB = (EIRP_J - EIRP_GCS) + 20*log10(d_gcs / d_j) - 10*log10(B_j / B_sig) - L_pol
        bw_ratio_db = 10.0 * np.log10(max(self.b_j_mhz / self.b_sig_mhz, 1.0))
        dist_ratio_db = 20.0 * np.log10(d_gcs / d_j)
        j_to_s_db = (eirp_j_dbm - self.eirp_gcs_dbm) + dist_ratio_db - bw_ratio_db - self.l_pol_db

        path_loss_j_db = 20.0 * np.log10(4.0 * np.pi * d_j / lambda_m)
        p_rx_jammer_dbm = eirp_j_dbm - path_loss_j_db - self.l_pol_db

        p_rx_s_lin = 10.0 ** (p_rx_signal_dbm / 10.0)
        p_rx_j_lin = 10.0 ** (p_rx_jammer_dbm / 10.0)
        p_n_lin = 10.0 ** (p_noise_dbm / 10.0)

        sinr_lin = p_rx_s_lin / (p_rx_j_lin + p_n_lin)
        sinr_db = float(10.0 * np.log10(max(sinr_lin, 1e-12)))

        ber = float(0.5 * erfc(np.sqrt(max(sinr_lin, 0.0))))
        per = float(1.0 - (1.0 - np.clip(ber, 0.0, 0.5)) ** packet_len_bits)

        # Soft-kill control disruption state machine
        if sinr_db < -4.0 or per > 0.95:
            link_state = "FORCED_LANDING"
        elif sinr_db < 4.0 or per > 0.70:
            link_state = "HOVER_LOCK"
        elif sinr_db < 10.0 or per > 0.30:
            link_state = "LINK_LOST"
        else:
            link_state = "NORMAL"

        return JammingResult(
            drone_id=drone_id,
            sinr_db=sinr_db,
            ber=ber,
            per=per,
            link_state=link_state,
            j_to_s_db=float(j_to_s_db),
            received_jammer_power_dbm=float(p_rx_jammer_dbm),
            received_signal_power_dbm=float(p_rx_signal_dbm),
        )
