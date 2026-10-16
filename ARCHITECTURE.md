# Garuda-Aegis (SIH26247) — Advanced Multi-Sensor Data Fusion, Radar/RF Physics & EW Counter-UAS Integration Blueprint

To build **Garuda-Aegis (SIH26247)** without writing $15,000+$ lines of radar signal processing, multi-target tracking math, and 3D WebGL shaders from scratch, you must strictly separate **Full-Stack Application Skeletons** (which you `git clone` and modify as your project chassis) from **Scientific/Defense Math SDKs** (which you install via `pip` and call inside your backend modules).

---

## 1. The Verdict: Deep-Dive Repository Audit (What to Clone, Keep, Discard & Upgrade)

Do **not** clone `dstl/Stone-Soup`, `radarsimx/radarsimpy`, or `rlabbe/filterpy` as your base Git repository. Those three repositories are pure mathematical libraries—they contain zero FastAPI/WebSocket servers, zero simulation tick loops, and zero frontend UI code.

Instead, build your project using a **3-Repository Graft Strategy**, combining the best Python C-UAS backend, the best 3D swarm/jamming simulator, and the best React WebGL tactical display:

### Base #1 (Primary Python Backend Chassis): `AAH20/sky-sentinel`
* **Why It Wins as Your Core Skeleton:** It is already structured as an end-to-end Python Counter-UAS application that mirrors the exact functional domain of the Garuda-Aegis PRD: passive RF interception, protocol fingerprinting, GNSS spoofing detection, target tracking, and countermeasure triggering.
* **What You Keep Intact:**
  * **RF Protocol Fingerprinting Engine:** Detection and classification rules for **DJI OcuSync ($2.4\text{ GHz}$ / $5.8\text{ GHz}$)** chirp/OFDM signatures and **MAVLink v1/v2** telemetry packet structures (extracting drone ID, pilot home coordinates, and battery/attitude flags).
  * **GNSS/GPS Spoofing Detector:** Logic that monitors Carrier-to-Noise-Density ratio ($C/N_0$) spikes, clock bias drifts, and sudden ephemeris/position jumps between RF-decoded MAVLink GPS coordinates and physical radar returns.
  * **Async Telemetry Dispatcher:** The core Python event loop that packages threat alerts and target tracks into JSON streams.
* **What You Rip Out & Upgrade:**
  * **Delete the Basic Linear Kalman Filter:** `sky-sentinel` uses a simplified linear Constant Velocity (CV) tracker in Cartesian coordinates. It fails when drones execute high-G evasive turns or when ingesting spherical radar measurements $(r, \alpha, \varepsilon, \dot{r})$. Replace it with a **9-state Constant Acceleration (CA) Unscented Kalman Filter (UKF)** powered by `filterpy` and `Stone-Soup`.
  * **Replace Synthetic Sensor Noise:** Upgrade its dummy target detections with physics-based Swerling Case 1 Radar Cross Section (RCS) fluctuations and rotor micro-Doppler modulation from `radarsimpy`.
* **Advanced Engineering Upgrade (Cross-Modal Spoofing Residuals):**
  * Compute the statistical innovation discrepancy between the MAVLink-reported GNSS position $\mathbf{p}_{\text{GNSS}}$ and the UKF radar-fused posterior position $\hat{\mathbf{p}}_{k|k}$ using the spatial sub-block $\mathbf{P}_{\text{pos}} = \mathbf{P}_{k|k}[0:3, 0:3]$:
    $$\gamma_{\text{spoof}} = (\mathbf{p}_{\text{GNSS}} - \hat{\mathbf{p}}_{k|k})^T \left(\mathbf{P}_{\text{pos}} + \mathbf{R}_{\text{GNSS}}\right)^{-1} (\mathbf{p}_{\text{GNSS}} - \hat{\mathbf{p}}_{k|k})$$
  * Trigger a `GNSS_SPOOF_CONFIRMED` flag whenever $\gamma_{\text{spoof}} > \chi^2_{3, 0.999} = 16.266$ simultaneously with an anomalous carrier-to-noise ratio spike ($\Delta C/N_0 > 6\text{ dB-Hz}$).

### Base #2 (3D Swarm Mobility, EW Jamming & Live Web Server): `Zihao-Felix-Zhou/UavNetSim-v1`
* **Why It Wins for Simulation & Electronic Warfare:** It is a modern Python 3.12 platform (`main.py serve --port 8000`) with a built-in web server and 3D multi-UAV swarm simulation loop. Crucially, it models the **physical wireless channel** between nodes—including free-space path loss, Signal-to-Interference-plus-Noise Ratio ($\text{SINR}$), co-channel interference, and packet drop probability.
* **What You Keep Intact:**
  * **3D Swarm Mobility Engine (`simulation/`):** The 3D Gauss-Markov random mobility model and coordinated waypoint swarm formation state machines.
  * **Wireless SINR & Packet Loss Calculator:** The mathematical functions computing received signal power $P_{rx}$, interference power $I$, thermal noise $N_0$, and resulting Bit Error Rate ($\text{BER}$) / Packet Error Rate ($\text{PER}$).
  * **Built-In Web Console (Optional Fast Fallback):** If your team wants a working 3D browser visualization within $15\text{ minutes}$ before customizing React WebGL, its `frontend/` directory works out of the box with `main.py serve`.
* **What You Rip Out & Upgrade:**
  * **Convert Co-Channel Interference into Offensive EW Jamming (`backend/app/defense/rf_jammer.py`):** Instead of modeling friendly UAV-to-UAV interference, turn the ground station into a directional high-power RF Jammer. Inject Jammer Effective Isotropic Radiated Power ($\text{EIRP}_J$) and antenna gain $G_J(\theta, \phi)$ into `UavNetSim-v1`'s $\text{SINR}$ equation to compute the **Jamming-to-Signal Ratio ($J/S$)**. When $\text{SINR}$ drops below the OcuSync/MAVLink demodulation threshold (e.g., $< 4\text{ dB}$), force the swarm agent's state machine into `LINK_LOST` $\to$ `HOVER_LOCK` or `FORCED_LANDING`.
  * **Upgrade Kinematics with 6-DOF Drag (`backend/app/core/physics_engine.py`):** Inject the aerodynamic drag matrix and rotor downwash equations from `utiasDSL/gym-pybullet-drones` into `UavNetSim-v1`'s position update loop.

### Base #3 (Tactical C2 UI & Containerization): `mtepenner/cuas-radio-interceptor`
* **Why It Wins for Visual Impact:** Hackathon judges evaluate your system through its Command & Control (C2) screen. This repository includes a military-grade **React + WebGL tactical radar/map dashboard** and a multi-service **`docker-compose.yml`**.
* **Critical Warning (What to Delete Immediately):**
  * Its backend signal processing and API layers are written in **C++ and Go**. **Delete the C++ and Go backend directories immediately.** Attempting to compile and bridge C++/Go with your Python `backend/app/` architecture will cost your team $10+$ hours in build errors.
* **What You Extract & Upgrade:**
  * Copy only the `frontend/` (React WebGL UI) and `docker-compose.yml`.
  * Update the frontend WebSocket hook (`useWebSocket` / telemetry service) so it listens to your Python FastAPI server at `ws://localhost:8000/ws/telemetry` and sends jammer activation commands via `POST http://localhost:8000/api/v1/defense/jam`.

---

## 2. Architectural Breakdown: Clone vs. `pip install` (File-by-File Mapping)

| Repository / Package | Integration Method | Target Location in Garuda-Aegis (`prd.md`) | Exact Classes, Modules & Physics Equations Used | Custom Glue Code You Must Write |
| :--- | :--- | :--- | :--- | :--- |
| **`AAH20/sky-sentinel`** | `git clone` (Core Base) | `backend/app/sensors/rf_direction_finder.py` & `backend/app/main.py` | OcuSync/MAVLink packet dissectors, GNSS $C/N_0$ spoofing heuristics, async WebSocket broadcast loop | Refactor folder names to match `backend/app/`; route raw RF bearings into the UKF fusion queue |
| **`Zihao-Felix-Zhou/UavNetSim-v1`** | `git clone` (Sim & EW Base) | `backend/app/defense/rf_jammer.py` & `backend/app/simulation/` | 3D Gauss-Markov mobility, Log-distance path loss, $\text{SINR} = \frac{P_S}{P_I + P_J + N_0}$, packet loss probability | Expose a `trigger_directional_jammer(azimuth, elevation, bandwidth, power_dbm)` method that degrades target UAV link quality |
| **`mtepenner/cuas-radio-interceptor`** | `git clone` (UI & Docker Only) | `frontend/` & `docker-compose.yml` | React WebGL 3D airspace canvas, polar radar PPI sweep widget, threat table, Docker network bridge | Discard C++/Go backend; map incoming Python WebSocket JSON keys (`tracks`, `detections`, `jammer_status`) to React state |
| **`dstl/Stone-Soup`** | `pip install stonesoup` | `backend/app/fusion/track_manager.py` & `associator.py` | `DistanceHypothesiser`, `Mahalanobis` ($\chi^2$ gating), `GlobalNearestNeighbour` (Hungarian algorithm), track lifecycle | Convert custom UKF state dictionaries into Stone-Soup `GaussianState` and `Detection` objects for $M\text{-of-}N$ track confirmation |
| **`rlabbe/filterpy`** | `pip install filterpy` | `backend/app/fusion/unscented_kalman_filter.py` | `MerweScaledSigmaPoints(n=9, alpha=0.1, beta=2.0, kappa=-6)`, `UnscentedKalmanFilter(dim_x=9, dim_z=4)` | Define `fx` (3D CA state transition), `hx` (Cartesian-to-spherical radar projection), and custom `z_mean_fn` / `residual_z` for $[-\pi, \pi)$ angle wrapping |
| **`radarsimx/radarsimpy`** | `pip install radarsimpy` | `backend/app/sensors/radar_3d.py` & `rf_direction_finder.py` | Pulse-Doppler baseband, Swerling 1 RCS, rotor blade micro-Doppler sidebands, `cfar_ca_1d`, `cfar_os_1d`, Root-MUSIC DoA | Wrap radar physics into a lightweight per-tick sensor function that takes true 3D drone states and outputs noisy $(r, \alpha, \varepsilon, v_r)$ detections |
| **`utiasDSL/gym-pybullet-drones`** | Copy math only (No PyBullet GUI) | `backend/app/core/physics_engine.py` | 6-DOF Newton-Euler equations, parasitic drag $\mathbf{F}_d = -\frac{1}{2}\rho C_d A \|\mathbf{v}\|\mathbf{v}$, inter-drone downwash deficit | Copy only the NumPy drag/downwash vector math into your simulation tick; do **not** run `pybullet.connect(p.GUI)` on a headless server |

---

## 3. Advanced Mathematical Formulations & Defense SDK Wiring

### 3.1 9-State Sigma-Point UKF (`rlabbe/filterpy` in `backend/app/fusion/unscented_kalman_filter.py`)

* **State Vector ($\mathbf{x}_k \in \mathbb{R}^9$):**
  $$\mathbf{x}_k = \begin{bmatrix} x & y & z & v_x & v_y & v_z & a_x & a_y & a_z \end{bmatrix}^T$$

* **State Transition Matrix ($\mathbf{F}(\Delta t) \in \mathbb{R}^{9 \times 9}$ — 3D Constant Acceleration):**
  $$\mathbf{F}(\Delta t) = \begin{bmatrix} \mathbf{I}_3 & \Delta t \mathbf{I}_3 & \frac{1}{2}\Delta t^2 \mathbf{I}_3 \\ \mathbf{0}_3 & \mathbf{I}_3 & \Delta t \mathbf{I}_3 \\ \mathbf{0}_3 & \mathbf{0}_3 & \mathbf{I}_3 \end{bmatrix}$$

* **Continuous White Noise Jerk Process Covariance ($\mathbf{Q}(\Delta t) \in \mathbb{R}^{9 \times 9}$):**
  Given spectral density $q_j$ ($\text{m}^2/\text{s}^5$) modeling sudden evasive quadcopter snap-maneuvers:
  $$\mathbf{Q}(\Delta t) = q_j \begin{bmatrix} \frac{\Delta t^5}{20}\mathbf{I}_3 & \frac{\Delta t^4}{8}\mathbf{I}_3 & \frac{\Delta t^3}{6}\mathbf{I}_3 \\ \frac{\Delta t^4}{8}\mathbf{I}_3 & \frac{\Delta t^3}{3}\mathbf{I}_3 & \frac{\Delta t^2}{2}\mathbf{I}_3 \\ \frac{\Delta t^3}{6}\mathbf{I}_3 & \frac{\Delta t^2}{2}\mathbf{I}_3 & \Delta t \mathbf{I}_3 \end{bmatrix}$$

* **Van der Merwe Scaled Sigma Points ($2n + 1 = 19$ points):**
  Using scaling parameters $\alpha = 0.1$, $\beta = 2.0$ (optimal for Gaussian priors), and $\kappa = 3 - n = -6$, the composite scaling parameter is $\lambda = \alpha^2(n + \kappa) - n$:
  $$\mathcal{X}_0 = \hat{\mathbf{x}}, \quad \mathcal{X}_i = \hat{\mathbf{x}} + \left(\sqrt{(n+\lambda)\mathbf{P}}\right)_i \quad (i=1,\dots,n), \quad \mathcal{X}_{i+n} = \hat{\mathbf{x}} - \left(\sqrt{(n+\lambda)\mathbf{P}}\right)_i$$
  $$W_0^{(m)} = \frac{\lambda}{n+\lambda}, \quad W_0^{(c)} = \frac{\lambda}{n+\lambda} + (1 - \alpha^2 + \beta), \quad W_i^{(m)} = W_i^{(c)} = \frac{1}{2(n+\lambda)}$$

* **Heterogeneous Non-Linear Measurement Models:**
  1. **Active 3D Pulse-Doppler Radar ($\mathbf{z}_{\text{rad}} \in \mathbb{R}^4$):**
     $$h_{\text{rad}}(\mathbf{x}) = \begin{bmatrix} r \\ \alpha \\ \varepsilon \\ \dot{r} \end{bmatrix} = \begin{bmatrix} \sqrt{x^2 + y^2 + z^2} \\ \text{atan2}(y, x) \\ \arcsin\left(\frac{z}{\sqrt{x^2 + y^2 + z^2}}\right) \\ \frac{x v_x + y v_y + z v_z}{\sqrt{x^2 + y^2 + z^2}} \end{bmatrix}$$
  2. **Passive RF Direction Finder Line-of-Bearing ($\mathbf{z}_{\text{rf}} \in \mathbb{R}^2$):**
     $$h_{\text{rf}}(\mathbf{x}) = \begin{bmatrix} \alpha \\ \varepsilon \end{bmatrix} = \begin{bmatrix} \text{atan2}(y - y_s, x - x_s) \\ \arcsin\left(\frac{z - z_s}{\|\mathbf{p} - \mathbf{p}_s\|_2}\right) \end{bmatrix}$$

* **Circular Manifold Angle Wrapping Callbacks:**
  When a target crosses the $\pm \pi$ azimuth boundary behind the sensor array, standard Euclidean subtraction produces a $2\pi$ discontinuity that corrupts the innovation covariance $\mathbf{S}_k$. Pass custom functions to `UnscentedKalmanFilter`:
  * `residual_z`: Wraps angular components via $\Delta\theta = (\theta_a - \theta_b + \pi) \bmod 2\pi - \pi$.
  * `z_mean_fn`: Computes the exact Fréchet mean on the unit circle $S^1$:
    $$\bar{\theta} = \text{atan2}\left(\sum_{i=0}^{2n} W_i^{(m)} \sin\mathcal{Z}_{i,\theta}, \; \sum_{i=0}^{2n} W_i^{(m)} \cos\mathcal{Z}_{i,\theta}\right)$$

---

### 3.2 Mahalanobis Gating & Hungarian GNN (`dstl/Stone-Soup` in `backend/app/fusion/track_manager.py`)

* **Innovation & Normalized Innovation Squared (NIS):**
  For track $i$ and measurement $j$, let $\boldsymbol{\nu}_{i,j} = \text{residual\_z}(\mathbf{z}_j, \hat{\mathbf{z}}_{i, k|k-1})$ and $\mathbf{S}_i = \sum_{m=0}^{2n} W_m^{(c)} (\mathcal{Z}_m - \hat{\mathbf{z}}_i)(\mathcal{Z}_m - \hat{\mathbf{z}}_i)^T + \mathbf{R}$. The squared Mahalanobis distance is:
  $$d_M^2(i, j) = \boldsymbol{\nu}_{i,j}^T \mathbf{S}_i^{-1} \boldsymbol{\nu}_{i,j}$$
* **Chi-Square ($\chi^2$) Statistical Gate:**
  * For 4D Radar measurements ($\text{df} = 4, P_G = 0.99$): Gate threshold $\gamma_4 = \chi^2_{4, 0.99} = 13.277$.
  * For 2D Passive RF bearings ($\text{df} = 2, P_G = 0.99$): Gate threshold $\gamma_2 = \chi^2_{2, 0.99} = 9.210$.
* **Penalized Log-Likelihood Cost Matrix for GNN:**
  To prevent tracks with bloated uncertainty covariance $\mathbf{S}_i$ from stealing measurements from tight tracks, form the assignment cost matrix $\mathbf{C} \in \mathbb{R}^{N_T \times N_D}$ using the Gaussian negative log-likelihood:
  $$C_{i,j} = \begin{cases} d_M^2(i, j) + \ln|\det(\mathbf{S}_i)| & \text{if } d_M^2(i, j) \le \gamma_{\text{df}} \\ \infty & \text{otherwise} \end{cases}$$
  Solve the minimum-weight bipartite matching in $O(\max(N_T, N_D)^3)$ via the Hungarian (Munkres) algorithm (`scipy.optimize.linear_sum_assignment` or Stone-Soup's `GlobalNearestNeighbour`).

---

### 3.3 3D Radar & RF Direction Finder Physics (`radarsimx/radarsimpy` in `backend/app/sensors/`)

* **Swerling Case 1 RCS Scintillation (`radar_3d.py`):**
  Models scan-to-scan target Radar Cross Section $\sigma$ fluctuations for small carbon-fiber quadcopters ($\sigma_{\text{avg}} \in [0.01, 0.05]\text{ m}^2$) via an exponential probability density function:
  $$p(\sigma) = \frac{1}{\sigma_{\text{avg}}} \exp\left(-\frac{\sigma}{\sigma_{\text{avg}}}\right), \quad \sigma \ge 0$$
* **Monostatic Coherent Pulse-Doppler Radar SNR:**
  $$\text{SNR} = \frac{P_t G_t G_r \lambda_c^2 \sigma N_{\text{pulses}} \tau_p}{(4\pi)^3 r^4 k_B T_0 F_n L_{\text{sys}}}$$
  where $N_{\text{pulses}}$ is the number of coherent processing interval (CPI) pulses, $\tau_p$ is the pulse width, $k_B = 1.38 \times 10^{-23}\text{ J/K}$, and $F_n$ is the receiver noise figure.
* **Cell-Averaging & Ordered-Statistic CFAR (`cfar_ca_1d` / `cfar_os_1d`):**
  Given desired Probability of False Alarm $P_{fa} = 10^{-6}$ across $N_{\text{ref}}$ reference cells surrounding $N_{\text{guard}}$ guard cells, the adaptive threshold multiplier $\alpha_{\text{CFAR}}$ is:
  $$\alpha_{\text{CFAR}} = N_{\text{ref}} \left(P_{fa}^{-1/N_{\text{ref}}} - 1\right), \quad T_{\text{CFAR}} = \alpha_{\text{CFAR}} \cdot \frac{1}{N_{\text{ref}}} \sum_{m=1}^{N_{\text{ref}}} Y_m$$
* **Rotor Micro-Doppler Blade Flash Modulation:**
  For a quadcopter with $N_r = 4$ rotors, $N_b$ blades per rotor of radius $L_b$ spinning at $\Omega\text{ rad/s}$ ($2\pi \cdot \text{RPM}/60$), the instantaneous phase modulation of the $k$-th blade is $\phi_k(t) = \frac{4\pi}{\lambda_c} \frac{L_b}{2} \cos(\varepsilon) \sin(\Omega t + \frac{2\pi k}{N_b})$, generating maximum Doppler sidebands:
  $$f_{mD}^{\max} = \pm \frac{2 f_c}{c} L_b \Omega \cos(\varepsilon)$$
  Hovering drones exhibit high-frequency blade flashes ($f_{mD}^{\max} \in [800, 2600]\text{ Hz}$) with periodic blade-flash cadence $f_{\text{flash}} = \frac{N_b \Omega}{2\pi}$, cleanly discriminating UAVs from birds ($f_{mD}^{\max} < 60\text{ Hz}$).
* **Root-MUSIC Subspace Direction of Arrival (`rf_direction_finder.py`):**
  For an $M$-element Uniform Linear/Circular Array receiving $K$ snapshots $\mathbf{X} \in \mathbb{C}^{M \times K}$, compute the sample spatial covariance matrix and its eigendecomposition:
  $$\hat{\mathbf{R}}_{xx} = \frac{1}{K}\mathbf{X}\mathbf{X}^H = \mathbf{U}_s \boldsymbol{\Lambda}_s \mathbf{U}_s^H + \mathbf{U}_n \boldsymbol{\Lambda}_n \mathbf{U}_n^H$$
  Construct the polynomial $p(z) = \mathbf{a}^T(z^{-1}) \mathbf{U}_n \mathbf{U}_n^H \mathbf{a}(z) = 0$ where $z = e^{j \frac{2\pi d}{\lambda} \sin\theta}$, extract the roots inside and closest to the unit circle $|z_m| \approx 1$, and recover the super-resolution bearing:
  $$\hat{\theta}_m = \arcsin\left(\frac{\lambda}{2\pi d} \arg(z_m)\right)$$

---

### 3.4 6-DOF Aerodynamics (`gym-pybullet-drones`) & EW Soft-Kill Jammer (`UavNetSim-v1`)

* **Parasitic Drag & Rotor Downwash Wake (`backend/app/core/physics_engine.py`):**
  Each drone's translational acceleration incorporates 3D anisotropic airframe drag and vertical downwash induced by higher-altitude swarm neighbors $(j)$ flying within horizontal radius $r_{xy} = \sqrt{(x_i - x_j)^2 + (y_i - y_j)^2} < 2.5 R_{\text{rotor}}$ and $\Delta z = z_j - z_i > 0$:
  $$\mathbf{a}_{i,\text{aero}} = -\frac{1}{2 m_i} \rho_{\text{air}} A_{\text{ref}} \mathbf{C}_d \|\mathbf{v}_i - \mathbf{v}_{\text{wind}}\|_2 (\mathbf{v}_i - \mathbf{v}_{\text{wind}}) - \sum_{j \ne i, z_j > z_i} w_{\text{wake}}(\Delta z, r_{xy}) \hat{\mathbf{e}}_z$$
  $$w_{\text{wake}}(\Delta z, r_{xy}) = v_{h,j} \left(\frac{R_{\text{rotor}}}{R_{\text{rotor}} + \kappa_w \Delta z}\right)^2 \exp\left(-\frac{r_{xy}^2}{2 (\sigma_0 + \kappa_w \Delta z)^2}\right)$$
* **Directional RF Jamming Link Budget (`backend/app/defense/rf_jammer.py`):**
  With jammer pointing at $(\alpha_J, \varepsilon_J)$ with half-power beamwidth $\theta_{3\text{dB}}$, the directional antenna gain off-axis is $G_J(\Delta\psi) = G_{J,\max} - 12 \left(\frac{\Delta\psi}{\theta_{3\text{dB}}}\right)^2\text{ (dBi)}$. The Jamming-to-Signal ratio at the UAV receiver is:
  $$\left(\frac{J}{S}\right)_{\text{dB}} = \left(\text{EIRP}_J(\Delta\psi) - \text{EIRP}_{\text{GCS}}\right) + 20\log_{10}\left(\frac{d_{\text{GCS}}}{d_J}\right) - 10\log_{10}\left(\frac{B_J}{B_{\text{sig}}}\right) - L_{\text{pol}}$$
  The effective post-processing $\text{SINR}$ (linear scale) feeds into the OFDM/OcuSync QPSK Bit Error Rate and Packet Error Rate ($L_{\text{pkt}} = 512\text{ bits}$):
  $$\text{SINR}_{\text{lin}} = \frac{P_S}{P_J + N_0 B_{\text{sig}}}, \quad \text{BER} = \frac{1}{2}\text{erfc}\left(\sqrt{\text{SINR}_{\text{lin}}}\right), \quad \text{PER} = 1 - (1 - \text{BER})^{L_{\text{pkt}}}$$

---

## 4. Fast-Track Integration Blueprint (How to Merge Them in 1 Day)

### Step 1: Initialize Your Workspace & Graft the Repositories (Hours 0–2)

Run these commands to pull the three base repositories into a staging folder, copy only the relevant modules into your unified `garuda-aegis` directory structure, and discard the C++/Go bloat:

```bash
# 1. Create clean workspace and staging area
mkdir -p garuda-aegis/backend/app/{core,sensors,fusion,defense,simulation,api}
mkdir -p garuda-aegis/frontend
mkdir -p _staging && cd _staging

# 2. Clone the 3 base repositories
git clone https://github.com/AAH20/sky-sentinel.git
git clone https://github.com/Zihao-Felix-Zhou/UavNetSim-v1.git
git clone https://github.com/mtepenner/cuas-radio-interceptor.git

# 3. Graft Python C-UAS & RF/Spoofing modules from sky-sentinel
cp -r sky-sentinel/* ../garuda-aegis/backend/app/sensors/

# 4. Graft 3D Swarm Mobility & SINR Channel engine from UavNetSim-v1
cp -r UavNetSim-v1/simulation/* ../garuda-aegis/backend/app/simulation/

# 5. Graft ONLY the React WebGL UI and Docker Compose from cuas-radio-interceptor
cp -r cuas-radio-interceptor/frontend/* ../garuda-aegis/frontend/
cp cuas-radio-interceptor/docker-compose.yml ../garuda-aegis/
cd ../garuda-aegis && rm -rf ../_staging
```

Your resulting target directory tree will cleanly match `prd.md`:

```text
garuda-aegis/
├── docker-compose.yml                  # Extracted from cuas-radio-interceptor (updated for Python FastAPI)
├── frontend/                           # React + WebGL Tactical Dashboard from cuas-radio-interceptor
│   ├── src/components/TacticalMap3D.tsx
│   ├── src/components/RadarPPI.tsx
│   └── src/services/telemetrySocket.ts # Pointed to ws://localhost:8000/ws/telemetry
└── backend/
    ├── requirements.txt                # Unified Python 3.11/3.12 dependencies
    └── app/
        ├── main.py                     # FastAPI + Asyncio 20Hz simulation & telemetry server
        ├── core/
        │   └── physics_engine.py       # 6-DOF drag & downwash math from gym-pybullet-drones
        ├── simulation/
        │   └── swarm_manager.py        # 3D Gauss-Markov & waypoint swarm loop from UavNetSim-v1
        ├── sensors/
        │   ├── radar_3d.py             # Swerling 1 RCS, CFAR & micro-Doppler via radarsimpy
        │   └── rf_direction_finder.py  # OcuSync/MAVLink parser (sky-sentinel) + Root-MUSIC DoA
        ├── fusion/
        │   ├── unscented_kalman_filter.py # 9-state MerweScaledSigmaPoints UKF via filterpy
        │   └── track_manager.py        # Mahalanobis gating & Hungarian GNN via Stone-Soup
        └── defense/
            └── rf_jammer.py            # Directional SINR / J-to-S packet loss jammer from UavNetSim-v1
```

---

### Step 2: Create the Unified `backend/requirements.txt` (Hours 2–3)

Install the scientific and defense libraries inside a Python 3.11 or 3.12 virtual environment:

```txt
fastapi>=0.110.0
uvicorn[standard]>=0.29.0
websockets>=12.0
numpy>=1.26.4,<2.1.0
scipy>=1.13.0
filterpy>=1.4.5
stonesoup>=1.3
radarsimpy>=12.1.0
pydantic>=2.7.0
```

> **Integration Note on `radarsimpy`:** If a team member's laptop lacks the C++ redistributable binaries for `radarsimpy`, implement a seamless NumPy fallback inside `radar_3d.py` using `np.random.exponential(scale=rcs_mean)` for Swerling Case 1 RCS, `scipy.linalg.eigh` for Root-MUSIC subspace DoA, and `scipy.ndimage.convolve1d` for 1D CA-CFAR / OS-CFAR sliding windows. That guarantees your pipeline runs identically on any machine.

---

### Step 3: Wire the 9-State UKF & Stone-Soup GNN Pipeline (Hours 3–10)

#### 3.1 Production Implementation: `backend/app/fusion/unscented_kalman_filter.py`

```python
import numpy as np
from scipy.linalg import block_diag
from filterpy.kalman import UnscentedKalmanFilter, MerweScaledSigmaPoints


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
    r = max(np.sqrt(px**2 + py**2 + pz**2), 1e-3)
    az = np.arctan2(py, px)
    el = np.arcsin(np.clip(pz / r, -1.0, 1.0))
    r_dot = (px * vx + py * vy + pz * vz) / r
    return np.array([r, az, el, r_dot])


def hx_rf_bearing(x: np.ndarray, sensor_pos: np.ndarray = np.zeros(3)) -> np.ndarray:
    """Maps 9-state Cartesian vector to 2D passive RF Line-of-Bearing [az, el]."""
    dx = x[0] - sensor_pos[0]
    dy = x[1] - sensor_pos[1]
    dz = x[2] - sensor_pos[2]
    r = max(np.sqrt(dx**2 + dy**2 + dz**2), 1e-3)
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
        S += self.R_radar
        nu = residual_z_radar(z_rad, z_pred)
        d_m2 = float(nu.T @ np.linalg.solve(S, nu))
        return d_m2, nu, S

    def update_radar(self, z_rad: np.ndarray) -> None:
        d_m2, _, _ = self.compute_radar_mahalanobis(z_rad)
        self.last_nis = d_m2
        self.ukf.update(z_rad, R=self.R_radar, hx=hx_radar_3d)

    def update_rf_lob(self, z_rf: np.ndarray, sensor_pos: np.ndarray = np.zeros(3)) -> float:
        """Sequential unscented update for 2D Passive RF Line-of-Bearing measurement [az, el]."""
        sigmas_h = np.array([hx_rf_bearing(s, sensor_pos) for s in self.ukf.sigmas_f])
        z_pred = z_mean_rf_lob(sigmas_h, self.ukf.Wm)
        S = np.zeros((2, 2))
        Pxz = np.zeros((9, 2))
        for i in range(sigmas_h.shape[0]):
            dz = residual_z_rf(sigmas_h[i], z_pred)
            dx = residual_x(self.ukf.sigmas_f[i], self.ukf.x)
            S += self.ukf.Wc[i] * np.outer(dz, dz)
            Pxz += self.ukf.Wc[i] * np.outer(dx, dz)
        S += self.R_rf
        nu = residual_z_rf(z_rf, z_pred)
        d_m2 = float(nu.T @ np.linalg.solve(S, nu))
        if d_m2 <= 9.210:  # Chi-square df=2, alpha=0.99
            K = Pxz @ np.linalg.inv(S)
            self.ukf.x = self.ukf.x + K @ nu
            self.ukf.P = self.ukf.P - K @ S @ K.T
            self.ukf.P = 0.5 * (self.ukf.P + self.ukf.P.T)
        return d_m2
```

#### 3.2 Production Implementation: `backend/app/fusion/track_manager.py`

```python
from dataclasses import dataclass, field
from collections import deque
import numpy as np
from scipy.optimize import linear_sum_assignment
from .unscented_kalman_filter import GarudaTargetUKF

CHI2_GATE_4D_99 = 13.277  # df=4, p=0.99


@dataclass
class TrackRecord:
    track_id: str
    ukf: GarudaTargetUKF
    status: str = "TENTATIVE"  # TENTATIVE -> CONFIRMED -> DELETED
    hit_Window: deque = field(default_factory=lambda: deque(maxlen=5))
    missed_scans: int = 0
    classification: str = "UNKNOWN"
    micro_doppler_hz: float = 0.0
    gnss_spoof_flag: bool = False
    ew_status: str = "MONITORING"
    link_sinr_db: float = 18.0
    packet_loss_pct: float = 0.0


class MultiTargetTrackManager:
    """Implements Mahalanobis Chi-Square gating, Hungarian GNN, and M-of-N (3/5) track management."""

    def __init__(self, dt: float = 0.05):
        self.dt = dt
        self.tracks: dict[str, TrackRecord] = {}
        self._next_id = 1

    def step_fusion(self, radar_detections: list[dict], rf_bearings: list[dict]) -> list[TrackRecord]:
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
                    log_det_s = max(np.linalg.slogdet(S)[1], -10.0)
                    cost_matrix[i, j] = d_m2 + max(0.0, log_det_s)

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
                    trk.hit_Window.append(1)
                    trk.missed_scans = 0
                    trk.micro_doppler_hz = det.get("micro_doppler_hz", 0.0)
                    trk.classification = (
                        "HOSTILE_QUADCOPTER" if trk.micro_doppler_hz > 600.0 else "AVIAN_CLUTTER"
                    )

        # 4. Handle missed tracks and M-of-N lifecycle transitions
        for i, trk in enumerate(track_list):
            if i not in matched_tracks:
                trk.hit_Window.append(0)
                trk.missed_scans += 1
            if trk.status == "TENTATIVE" and sum(trk.hit_Window) >= 3:
                trk.status = "CONFIRMED"
            if trk.missed_scans >= 5 or (trk.status == "TENTATIVE" and len(trk.hit_Window) == 5 and sum(trk.hit_Window) < 2):
                trk.status = "DELETED"
                del self.tracks[trk.track_id]

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
                new_trk = TrackRecord(track_id=t_id, ukf=GarudaTargetUKF(init_x, self.dt))
                new_trk.hit_Window.append(1)
                new_trk.micro_doppler_hz = det.get("micro_doppler_hz", 0.0)
                self.tracks[t_id] = new_trk

        # 6. Fuse Passive RF Direction-Finder LOBs into active tracks
        for rf in rf_bearings:
            z_rf = np.array([rf["az_rad"], rf["el_rad"]])
            for trk in self.tracks.values():
                d_rf = trk.ukf.update_rf_lob(z_rf)
                if d_rf <= 9.210 and rf.get("gnss_spoof_flag", False):
                    trk.gnss_spoof_flag = True

        return [t for t in self.tracks.values() if t.status == "CONFIRMED"]
```

---

### Step 4: Connect the 3D Swarm Physics, Sensors & EW Jammer Loop (Hours 10–18)

In `backend/app/main.py`, run a **20 Hz (`dt = 0.05s`) asynchronous background tick loop** that chains the modules in five sequential steps per frame:

1. **Swarm Kinematics Step (`swarm_manager.py` + `physics_engine.py`):**
   Advance each drone's ground-truth state using `UavNetSim-v1`'s 3D Gauss-Markov/waypoint velocity command, then apply `gym-pybullet-drones`'s parasitic drag $\mathbf{a}_{\text{drag}} = -\frac{1}{2 m}\rho C_d A \|\mathbf{v}\|\mathbf{v}$ and vertical downwash deficit when swarm drones stack within $2\text{ m}$ horizontally.
2. **Radar & RF Sensor Step (`radar_3d.py` + `rf_direction_finder.py`):**
   * Compute each drone's Swerling Case 1 RCS and $\text{SNR}$ via the radar range equation $\text{SNR} \propto \frac{\sigma}{r^4}$. Pass signal returns through a 1D CA-CFAR / OS-CFAR threshold detector (`radarsimpy`) and extract micro-Doppler blade flash frequencies.
   * Simultaneously run the RF Direction Finder (`sky-sentinel` OcuSync/MAVLink sniffer + Root-MUSIC DoA) to output passive azimuth/elevation lines-of-bearing (LOBs) and check for GNSS spoofing discrepancies.
3. **Multi-Sensor Data Fusion Step (`track_manager.py`):**
   Predict all 9-state UKF tracks forward by $\Delta t = 0.05\text{ s}$, gate incoming 3D Radar detections and 2D RF bearings via Mahalanobis distance ($\chi^2$), associate via Hungarian GNN, and update the posterior state vector $\hat{\mathbf{x}}_{k|k}$ and covariance $\mathbf{P}_{k|k}$.
4. **Electronic Warfare Soft-Kill Step (`rf_jammer.py`):**
   When an operator activates the jammer on a confirmed hostile track, calculate the Jamming-to-