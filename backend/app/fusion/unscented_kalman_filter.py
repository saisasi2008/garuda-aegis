import numpy as np
from filterpy.kalman import MerweScaledSigmaPoints, UnscentedKalmanFilter
from scipy.linalg import block_diag


def wrap_angle(angle: float) -> float:
    """Wraps angle into [-pi, pi)."""
    return (angle + np.pi) % (2.0 * np.pi) - np.pi


def residual_z_radar(z_a: np.ndarray, z_b: np.ndarray) -> np.ndarray:
    """Custom 4D radar residual handling circular azimuth (idx 1) and elevation (idx 2)."""
    res = z_a - z_b
    res[1] = wrap_angle(res[1])  # Azimuth [-pi, pi)
    res[2] = wrap_angle(res[2])  # Elevation [-pi/2, pi/2]
    return res


def residual_z_rf(z_a: np.ndarray, z_b: np.ndarray) -> np.ndarray:
    """Custom 2D passive RF bearing residual [az, el]."""
    res = z_a - z_b
    res[0] = wrap_angle(res[0])
    res[1] = wrap_angle(res[1])
    return res


def z_mean_spherical(sigmas: np.ndarray, Wm: np.ndarray) -> np.ndarray:
    """Computes weighted Fréchet circular mean of spherical radar measurements [r, az, el, r_dot]."""
    z_mean = np.zeros(4)
    z_mean[0] = np.dot(Wm, sigmas[:, 0])  # Range
    z_mean[1] = np.arctan2(np.dot(Wm, np.sin(sigmas[:, 1])), np.dot(Wm, np.cos(sigmas[:, 1])))  # Azimuth
    z_mean[2] = np.arctan2(np.dot(Wm, np.sin(sigmas[:, 2])), np.dot(Wm, np.cos(sigmas[:, 2])))  # Elevation
    z_mean[3] = np.dot(Wm, sigmas[:, 3])  # Radial velocity (Doppler)
    return z_mean


def z_mean_rf_lob(sigmas: np.ndarray, Wm: np.ndarray) -> np.ndarray:
    """Computes weighted circular mean of 2D passive RF Line-of-Bearing [az, el]."""
    z_mean = np.zeros(2)
    z_mean[0] = np.arctan2(np.dot(Wm, np.sin(sigmas[:, 0])), np.dot(Wm, np.cos(sigmas[:, 0])))
    z_mean[1] = np.arctan2(np.dot(Wm, np.sin(sigmas[:, 1])), np.dot(Wm, np.cos(sigmas[:, 1])))
    return z_mean


def residual_x(x_a: np.ndarray, x_b: np.ndarray) -> np.ndarray:
    """Euclidean residual for 9D Cartesian state vector."""
    return x_a - x_b


def state_mean_x(sigmas: np.ndarray, Wm: np.ndarray) -> np.ndarray:
    """Weighted mean for 9D Cartesian state vector."""
    return np.dot(Wm, sigmas)


def fx_constant_acceleration(x: np.ndarray, dt: float) -> np.ndarray:
    """9-state Constant Acceleration transition: [x, y, z, vx, vy, vz, ax, ay, az]."""
    F = np.eye(9)
    F[0:3, 3:6] = np.eye(3) * dt
    F[0:3, 6:9] = 0.5 * np.eye(3) * (dt ** 2)
    F[3:6, 6:9] = np.eye(3) * dt
    return F @ x


def build_cwna_process_noise(dt: float, jerk_psd: float = 4.5) -> np.ndarray:
    """Builds 9x9 Continuous White Noise Jerk process covariance matrix Q."""
    q11 = (dt ** 5) / 20.0 * np.eye(3)
    q12 = (dt ** 4) / 8.0 * np.eye(3)
    q13 = (dt ** 3) / 6.0 * np.eye(3)
    q22 = (dt ** 3) / 3.0 * np.eye(3)
    q23 = (dt ** 2) / 2.0 * np.eye(3)
    q33 = dt * np.eye(3)
    Q = np.block([
        [q11, q12, q13],
        [q12, q22, q23],
        [q13, q23, q33]
    ])
    return jerk_psd * Q


def hx_radar_3d(x: np.ndarray) -> np.ndarray:
    """Maps 9-state Cartesian vector to 4D spherical radar measurement [r, az, el, r_dot]."""
    px, py, pz, vx, vy, vz = x[0], x[1], x[2], x[3], x[4], x[5]
    r = max(float(np.sqrt(px**2 + py**2 + pz**2)), 1e-3)
    az = np.arctan2(py, px)
    el = np.arcsin(np.clip(pz / r, -1.0, 1.0))
    r_dot = (px * vx + py * vy + pz * vz) / r
    return np.array([r, az, el, r_dot])


def hx_rf_bearing(x: np.ndarray, sensor_pos: np.ndarray | None = None) -> np.ndarray:
    """Maps 9-state Cartesian vector to 2D passive RF Line-of-Bearing [az, el]."""
    s_pos = sensor_pos if sensor_pos is not None else np.zeros(3)
    dx = x[0] - s_pos[0]
    dy = x[1] - s_pos[1]
    dz = x[2] - s_pos[2]
    r = max(float(np.sqrt(dx**2 + dy**2 + dz**2)), 1e-3)
    az = np.arctan2(dy, dx)
    el = np.arcsin(np.clip(dz / r, -1.0, 1.0))
    return np.array([az, el])


class GarudaTargetUKF:
    """9-State Van der Merwe Scaled Sigma-Point UKF supporting dual Radar (4D) and RF LOB (2D) fusion."""

    def __init__(self, initial_state: np.ndarray, dt: float = 0.05, jerk_psd: float = 4.5):
        self.dt = dt
        self.points = MerweScaledSigmaPoints(n=9, alpha=0.1, beta=2.0, kappa=-6.0, subtract=residual_x)
        self.ukf = UnscentedKalmanFilter(
            dim_x=9,
            dim_z=4,
            dt=dt,
            fx=fx_constant_acceleration,
            hx=hx_radar_3d,
            points=self.points,
            x_mean_fn=state_mean_x,
            z_mean_fn=z_mean_spherical,
            residual_x=residual_x,
            residual_z=residual_z_radar,
        )
        self.ukf.x = initial_state.astype(float).copy()
        self.ukf.P = block_diag(np.eye(3) * 9.0, np.eye(3) * 4.0, np.eye(3) * 2.0)
        self.ukf.Q = build_cwna_process_noise(dt, jerk_psd)
        self.R_radar = np.diag([1.5**2, np.deg2rad(0.8)**2, np.deg2rad(1.0)**2, 0.4**2])
        self.R_rf = np.diag([np.deg2rad(1.8)**2, np.deg2rad(2.2)**2])
        self.ukf.R = self.R_radar
        self.last_nis: float = 0.0
        # Ensure sigmas_f is populated immediately upon instantiation
        self.ukf.sigmas_f = self.points.sigma_points(self.ukf.x, self.ukf.P)

    @property
    def x(self) -> np.ndarray:
        return self.ukf.x

    @property
    def P(self) -> np.ndarray:
        return self.ukf.P

    @property
    def position(self) -> np.ndarray:
        return self.ukf.x[0:3]

    @property
    def velocity(self) -> np.ndarray:
        return self.ukf.x[3:6]

    @property
    def acceleration(self) -> np.ndarray:
        return self.ukf.x[6:9]

    @property
    def state(self) -> np.ndarray:
        return self.ukf.x

    @property
    def covariance(self) -> np.ndarray:
        return self.ukf.P

    def predict(self, dt: float | None = None) -> tuple[np.ndarray, np.ndarray]:
        if dt is not None and dt != self.dt:
            self.dt = dt
            self.ukf.Q = build_cwna_process_noise(dt)
        self.ukf.predict(dt=self.dt)
        # Ensure symmetry and positive definiteness
        self.ukf.P = 0.5 * (self.ukf.P + self.ukf.P.T) + 1e-8 * np.eye(9)
        return self.ukf.x, self.ukf.P

    def compute_radar_mahalanobis(self, z_rad: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
        """Returns squared Mahalanobis distance d_M^2, innovation vector nu, and innovation covariance S."""
        sigmas_h = np.array([hx_radar_3d(s) for s in self.ukf.sigmas_f])
        z_pred = z_mean_spherical(sigmas_h, self.ukf.Wm)
        S = np.zeros((4, 4))
        for i in range(sigmas_h.shape[0]):
            dz = residual_z_radar(sigmas_h[i], z_pred)
            S += self.ukf.Wc[i] * np.outer(dz, dz)
        S += self.R_radar + 1e-6 * np.eye(4)
        nu = residual_z_radar(z_rad, z_pred)
        d_m2 = float(nu.T @ np.linalg.solve(S, nu))
        return d_m2, nu, S

    def update_radar(self, z_rad: np.ndarray) -> None:
        d_m2, _, _ = self.compute_radar_mahalanobis(z_rad)
        self.last_nis = d_m2
        self.ukf.update(z_rad, R=self.R_radar, hx=hx_radar_3d)
        self.ukf.P = 0.5 * (self.ukf.P + self.ukf.P.T) + 1e-8 * np.eye(9)
        self.ukf.sigmas_f = self.points.sigma_points(self.ukf.x, self.ukf.P)

    def compute_rf_mahalanobis(
        self,
        z_rf: np.ndarray,
        sensor_pos: np.ndarray | None = None,
    ) -> tuple[float, np.ndarray, np.ndarray, np.ndarray]:
        """Computes RF bearing Mahalanobis distance without modifying state."""
        s_pos = sensor_pos if sensor_pos is not None else np.zeros(3)
        sigmas_h = np.array([hx_rf_bearing(s, s_pos) for s in self.ukf.sigmas_f])
        z_pred = z_mean_rf_lob(sigmas_h, self.ukf.Wm)
        S = np.zeros((2, 2))
        Pxz = np.zeros((9, 2))
        for i in range(sigmas_h.shape[0]):
            dz = residual_z_rf(sigmas_h[i], z_pred)
            dx = residual_x(self.ukf.sigmas_f[i], self.ukf.x)
            S += self.ukf.Wc[i] * np.outer(dz, dz)
            Pxz += self.ukf.Wc[i] * np.outer(dx, dz)
        S += self.R_rf + 1e-6 * np.eye(2)
        nu = residual_z_rf(z_rf, z_pred)
        d_m2 = float(nu.T @ np.linalg.solve(S, nu))
        return d_m2, nu, S, Pxz

    def update_rf_lob(self, z_rf: np.ndarray, sensor_pos: np.ndarray | None = None) -> float:
        """Sequential unscented update for 2D Passive RF Line-of-Bearing measurement [az, el]."""
        d_m2, nu, S, Pxz = self.compute_rf_mahalanobis(z_rf, sensor_pos)
        if d_m2 <= 9.210:  # Chi-square df=2, alpha=0.99
            K = np.linalg.solve(S.T, Pxz.T).T
            self.ukf.x = self.ukf.x + K @ nu
            self.ukf.P = self.ukf.P - K @ S @ K.T
            self.ukf.P = 0.5 * (self.ukf.P + self.ukf.P.T) + 1e-8 * np.eye(9)
            self.ukf.sigmas_f = self.points.sigma_points(self.ukf.x, self.ukf.P)
        return d_m2
