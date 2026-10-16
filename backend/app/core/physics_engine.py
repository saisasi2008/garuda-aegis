import numpy as np


class DronePhysicsEngine:
    """
    6-DOF translation aerodynamics and downwash wake deficit model
    adapted from gym-pybullet-drones / UTIAS DSL mathematical specifications.
    """

    def __init__(
        self,
        rho_air: float = 1.225,
        default_mass: float = 1.5,
        ref_area: float = 0.05,
        cd_vec: tuple[float, float, float] = (0.25, 0.25, 0.40),
        rotor_radius: float = 0.15,
        num_rotors: int = 4,
        wake_expansion: float = 0.12,
        core_radius: float = 0.10,
    ):
        self.rho_air = rho_air
        self.mass = default_mass
        self.ref_area = ref_area
        self.Cd = np.diag(cd_vec)
        self.rotor_radius = rotor_radius
        self.num_rotors = num_rotors
        self.kappa_w = wake_expansion
        self.sigma_0 = core_radius
        self.g = 9.80665

        # Compute hover induced velocity v_h = sqrt(m*g / (2 * rho * pi * R^2 * N_r))
        disk_area = np.pi * (self.rotor_radius ** 2) * self.num_rotors
        self.v_h = np.sqrt((self.mass * self.g) / (2.0 * self.rho_air * disk_area))

    def compute_parasitic_drag_accel(
        self,
        velocity: np.ndarray,
        wind_velocity: np.ndarray | None = None,
        mass: float | None = None,
    ) -> np.ndarray:
        """
        Computes 3D anisotropic parasitic aerodynamic drag acceleration:
        a_drag = -1/(2*m) * rho * A_ref * Cd * ||v - v_wind|| * (v - v_wind)
        """
        w_vel = wind_velocity if wind_velocity is not None else np.zeros(3)
        m = mass if mass is not None else self.mass
        v_rel = velocity - w_vel
        v_rel_norm = np.linalg.norm(v_rel)
        if v_rel_norm < 1e-4:
            return np.zeros(3)

        force_drag = -0.5 * self.rho_air * self.ref_area * (self.Cd @ v_rel) * v_rel_norm
        return force_drag / m

    def compute_downwash_deficit(
        self,
        drone_pos: np.ndarray,
        other_drone_positions: list[np.ndarray],
    ) -> float:
        """
        Computes vertical downwash velocity deficit induced by higher-altitude neighbors:
        w_wake(delta_z, r_xy) = v_h * (R / (R + kappa_w * delta_z))^2 * exp(-r_xy^2 / (2*(sigma_0 + kappa_w * delta_z)^2))
        """
        w_total = 0.0
        x_i, y_i, z_i = drone_pos[0], drone_pos[1], drone_pos[2]

        for p_j in other_drone_positions:
            z_j = p_j[2]
            delta_z = z_j - z_i
            if delta_z <= 0.05:
                continue

            r_xy = np.sqrt((x_i - p_j[0]) ** 2 + (y_i - p_j[1]) ** 2)
            if r_xy > 2.5 * self.rotor_radius:
                continue

            radius_expansion = self.rotor_radius / (self.rotor_radius + self.kappa_w * delta_z)
            sigma_eff = self.sigma_0 + self.kappa_w * delta_z
            gaussian_radial = np.exp(-(r_xy ** 2) / (2.0 * (sigma_eff ** 2)))

            w_wake = self.v_h * (radius_expansion ** 2) * gaussian_radial
            w_total += w_wake

        return float(w_total)

    def apply_kinematics_step(
        self,
        position: np.ndarray,
        velocity: np.ndarray,
        commanded_accel: np.ndarray,
        dt: float,
        other_positions: list[np.ndarray] | None = None,
        wind_velocity: np.ndarray | None = None,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Integrates kinematics:
        a_total = a_cmd + a_drag - w_downwash * z_hat
        v_{k+1} = v_k + a_total * dt
        p_{k+1} = p_k + v_{k+1} * dt
        """
        w_vel = wind_velocity if wind_velocity is not None else np.zeros(3)
        a_drag = self.compute_parasitic_drag_accel(velocity, wind_velocity=w_vel)

        downwash_w = 0.0
        if other_positions:
            downwash_w = self.compute_downwash_deficit(position, other_positions)

        a_downwash = np.array([0.0, 0.0, -downwash_w * 0.5])  # deficit downwash acceleration
        total_accel = commanded_accel + a_drag + a_downwash

        new_velocity = velocity + total_accel * dt
        # Clamp velocity to max realistic speed (e.g. 25 m/s)
        speed = np.linalg.norm(new_velocity)
        if speed > 25.0:
            new_velocity = (new_velocity / speed) * 25.0

        new_position = position + new_velocity * dt
        # Prevent ground penetration
        if new_position[2] < 0.5:
            new_position[2] = 0.5
            new_velocity[2] = max(new_velocity[2], 0.0)

        return new_position, new_velocity, total_accel
