# Garuda-Aegis (SIH26247) 🛡️🛰️
### Advanced Multi-Sensor Data Fusion, Radar/RF Physics & EW Counter-UAS Tactical Defense Platform

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/Python-3.12-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)
![React](https://img.shields.io/badge/React-18-61dafb.svg)
![Three.js](https://img.shields.io/badge/Three.js-WebGL-black.svg)
![Tests](https://img.shields.io/badge/Tests-11%2F11%20Passed-brightgreen.svg)
![Code%20Quality](https://img.shields.io/badge/Ruff-0%20errors-brightgreen.svg)

---

## 📌 Executive Summary

**Garuda-Aegis** is an integrated Counter-Unmanned Aerial System (C-UAS) software platform engineered for real-time hostile drone detection, tracking, classification, and electronic warfare neutralization.

Designed around a **3-Repository Graft Strategy**, the system combines:
1. **`AAH20/sky-sentinel`**: Protocol fingerprinting (DJI OcuSync, MAVLink, ExpressLRS, LoRa), statistical GNSS spoofing residual detection, and telemetry dispatching.
2. **`Zihao-Felix-Zhou/UavNetSim-v1`**: 3D Gauss-Markov mobility and wireless link budgeting, upgraded into an active directional Electronic Warfare (EW) soft-kill RF jammer.
3. **`mtepenner/cuas-radio-interceptor`**: Polar Radar PPI sweep, Three.js 3D tactical airspace visualization, threat assessment table, and RF spectrum waterfall.

---

## 📐 Mathematical Foundations & Defense Specifications

### 1. 3D Pulse-Doppler Radar Physics (`radar_3d.py`)
* **Swerling Case 1 RCS Fluctuation**: Scan-to-scan target Radar Cross Section $\sigma$ for carbon-fiber quadcopters ($\sigma_{\text{avg}} \in [0.01, 0.05]\text{ m}^2$):
  $$p(\sigma) = \frac{1}{\sigma_{\text{avg}}} \exp\left(-\frac{\sigma}{\sigma_{\text{avg}}}\right)$$
* **Monostatic Pulse-Doppler SNR Equation**:
  $$\text{SNR} = \frac{P_t G_t G_r \lambda_c^2 \sigma N_{\text{pulses}} \tau_p}{(4\pi)^3 r^4 k_B T_0 F_n L_{\text{sys}}}$$
* **Cell-Averaging CFAR (CA-CFAR)**: Adaptive threshold multiplier $\alpha_{\text{CFAR}} = N_{\text{ref}} (P_{fa}^{-1/N_{\text{ref}}} - 1)$ for $P_{fa} = 10^{-6}$.
* **Rotor Micro-Doppler Blade Flash Modulation**:
  $$f_{mD}^{\max} = \pm \frac{2 f_c}{c} L_b \Omega \cos(\varepsilon)$$
  Cleanly discriminates multi-rotor UAVs ($f_{mD}^{\max} > 800\text{ Hz}$) from avian clutter ($f_{mD}^{\max} < 60\text{ Hz}$).

### 2. Passive RF Direction Finding & Anti-Spoofing (`rf_direction_finder.py`)
* **Root-MUSIC Subspace Super-Resolution DoA**: Eigendecomposition of spatial covariance matrix $\hat{\mathbf{R}}_{xx} = \mathbf{U}_s \boldsymbol{\Lambda}_s \mathbf{U}_s^H + \mathbf{U}_n \boldsymbol{\Lambda}_n \mathbf{U}_n^H$ with full $360^\circ$ hemisphere disambiguation.
* **Cross-Modal GNSS Spoofing Residual Test**:
  $$\gamma_{\text{spoof}} = (\mathbf{p}_{\text{GNSS}} - \hat{\mathbf{p}})^T (\mathbf{P}_{\text{pos}} + \mathbf{R}_{\text{GNSS}})^{-1} (\mathbf{p}_{\text{GNSS}} - \hat{\mathbf{p}})$$
  Flags spoofing if $\gamma_{\text{spoof}} > \chi^2_{3, 0.999} = 16.266$ and $\Delta C/N_0 > 6\text{ dB-Hz}$.

### 3. Multi-Sensor Data Fusion Engine (`unscented_kalman_filter.py` & `track_manager.py`)
* **9-State Constant Acceleration UKF**: State vector $\mathbf{x} = [x, y, z, v_x, v_y, v_z, a_x, a_y, a_z]^T$ using Van der Merwe scaled sigma points ($\alpha=0.1, \beta=2.0, \kappa=-6.0$).
* **Continuous White Noise Jerk (CWNJ) Process Noise**:
  $$\mathbf{Q}(\Delta t) = \tilde{q} \begin{bmatrix} \frac{\Delta t^5}{20}\mathbf{I}_3 & \frac{\Delta t^4}{8}\mathbf{I}_3 & \frac{\Delta t^3}{6}\mathbf{I}_3 \\ \frac{\Delta t^4}{8}\mathbf{I}_3 & \frac{\Delta t^3}{3}\mathbf{I}_3 & \frac{\Delta t^2}{2}\mathbf{I}_3 \\ \frac{\Delta t^3}{6}\mathbf{I}_3 & \frac{\Delta t^2}{2}\mathbf{I}_3 & \Delta t\mathbf{I}_3 \end{bmatrix}$$
* **Data Association**: Mahalanobis $\chi^2$ gating ($\chi^2_{4, 0.99} = 13.277, \chi^2_{2, 0.99} = 9.210$) + Hungarian algorithm (GNN) with penalized covariance log-determinant.
* **$M$-of-$N$ Track Lifecycle**: 3-out-of-5 hit promotion from `TENTATIVE` to `CONFIRMED`; 5 consecutive misses purge to `DELETED`.

### 4. 6-DOF Aerodynamics & EW Directional Jammer (`physics_engine.py` & `rf_jammer.py`)
* **Parasitic Drag & Rotor Wake Deficit**:
  $$\mathbf{a}_{\text{aero}} = -\frac{1}{2m} \rho_{\text{air}} A_{\text{ref}} \mathbf{C}_d \|\mathbf{v} - \mathbf{v}_{\text{wind}}\| (\mathbf{v} - \mathbf{v}_{\text{wind}}) - w_{\text{wake}}(\Delta z, r_{xy}) \hat{\mathbf{e}}_z$$
* **Directional Jamming Link Budget**: Off-axis gain $G_J(\Delta\psi) = G_{J,\max} - 12 (\Delta\psi / \theta_{3\text{dB}})^2$, with QPSK BER/PER and soft-kill reaction ladder: `NORMAL` $\to$ `LINK_LOST` $\to$ `HOVER_LOCK` $\to$ `FORCED_LANDING` $\to$ `NEUTRALIZED`.
* **FAA Part 89/107 Forensic Dossiers**: Export cryptographically verifiable incident dossiers signed with SHA-256 tamper-evident seals.

---

## 🗂️ Project Architecture

```text
garuda-aegis/
├── docker-compose.yml          # Multi-container orchestration (FastAPI + React/Nginx)
├── ARCHITECTURE.md             # Complete mathematical & integration specification
├── backend/
│   ├── Dockerfile              # Python 3.12-slim production container
│   ├── requirements.txt        # fastapi, uvicorn, scipy, filterpy, stonesoup, etc.
│   ├── app/
│   │   ├── main.py             # 20 Hz tick loop, WebSocket & REST controllers
│   │   ├── core/
│   │   │   └── physics_engine.py      # 6-DOF aerodynamics & downwash deficit
│   │   ├── simulation/
│   │   │   └── swarm_manager.py       # 3D Gauss-Markov swarm & EW reaction states
│   │   ├── sensors/
│   │   │   ├── radar_3d.py            # Swerling 1 RCS, CFAR, micro-Doppler
│   │   │   └── rf_direction_finder.py # Root-MUSIC DoA & GNSS spoofing detector
│   │   ├── fusion/
│   │   │   ├── unscented_kalman_filter.py # 9-state CWNA UKF
│   │   │   ├── associator.py              # Stone-Soup GNN data associator
│   │   │   └── track_manager.py           # Chi-Square gating & Hungarian lifecycle
│   │   ├── defense/
│   │   │   └── rf_jammer.py           # Directional EW jammer & J/S link budget
│   │   └── api/
│   │       └── dossier.py             # FAA Part 89/107 forensic incident dossiers
│   └── tests/
│       ├── test_garuda_aegis.py       # 10 unit test suites
│       └── test_live_simulation.py    # 20 Hz multi-tick integration test suite
└── frontend/
    ├── Dockerfile              # Multi-stage Node build + Nginx Alpine deployment
    ├── package.json
    ├── src/
    │   ├── types.ts            # Strongly-typed telemetry contracts
    │   ├── services/
    │   │   └── telemetrySocket.ts     # 20 Hz WebSocket client & C2 REST API
    │   ├── components/
    │   │   ├── RadarPPI.tsx           # Polar radar sweep, range rings & LOB strobes
    │   │   ├── TacticalMap3D.tsx      # Three.js 3D airspace & jammer cone volume
    │   │   ├── ThreatTable.tsx        # Fused threat table with Jam & Dossier actions
    │   │   ├── JammerControl.tsx      # Manual/Auto directional jammer beam controls
    │   │   ├── WaterfallDisplay.tsx   # RF spectrum waterfall display
    │   │   ├── ThreatAlerts.tsx       # Live intruder notifications
    │   │   └── SignalStrengthMeter.tsx# Real-time RSSI signal meter
    │   └── App.tsx             # Unified tactical C2 master console
```

---

## 🚀 Quick Start Guide

### Option A: Local Development (Fastest)

#### 1. Backend (FastAPI + Simulation)
```bash
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```
Backend will be live at `http://localhost:8000` (API Docs at `http://localhost:8000/docs`).

#### 2. Frontend (React + Vite + WebGL)
```bash
cd frontend
npm install
npm run dev
```
Open your browser at `http://localhost:5173`.

---

### Option B: Docker Compose (Production Deployment)

Run both the Python backend and React/Nginx frontend in isolated bridge containers:
```bash
docker compose up --build
```
* **C2 Tactical Dashboard**: `http://localhost:3000`
* **FastAPI Backend & WebSocket**: `http://localhost:8000`

---

## 🧪 Test Verification

Run the complete test suite:
```bash
cd backend
python -m pytest tests/ -v
```

Output:
```text
tests/test_garuda_aegis.py::test_angle_wrapping PASSED                   [  9%]
tests/test_garuda_aegis.py::test_ukf_prediction_and_radar_update PASSED  [ 18%]
tests/test_garuda_aegis.py::test_ukf_rf_lob_sequential_update PASSED     [ 27%]
tests/test_garuda_aegis.py::test_track_manager_lifecycle PASSED          [ 36%]
tests/test_garuda_aegis.py::test_radar_physics_swerling_and_micro_doppler PASSED [ 45%]
tests/test_garuda_aegis.py::test_rf_direction_finder_and_gnss_spoofing PASSED [ 54%]
tests/test_garuda_aegis.py::test_physics_drag_and_downwash PASSED        [ 63%]
tests/test_garuda_aegis.py::test_directional_rf_jammer_soft_kill PASSED  [ 72%]
tests/test_garuda_aegis.py::test_fastapi_rest_endpoints PASSED           [ 81%]
tests/test_garuda_aegis.py::test_stonesoup_data_associator PASSED        [ 90%]
tests/test_live_simulation.py::test_live_simulation_tick_progression PASSED [100%]

============================= 11 passed in 7.40s ==============================
```

Linting check:
```bash
python -m ruff check app/ tests/
# All checks passed! (0 errors, 0 warnings)
```

---

## 📡 REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Subsystem status, tick rate, active track count |
| `POST` | `/api/v1/defense/jam` | Directs and fires the high-power directional RF jammer |
| `POST` | `/api/v1/defense/disarm` | Deactivates the RF countermeasure beam |
| `GET` | `/api/v1/defense/status` | Returns jammer aim angles, power, and lock-on state |
| `POST` | `/api/v1/simulation/reset` | Resets swarm positions, UKF tracks, and jammer state |
| `GET` | `/api/v1/forensics/dossier/{id}` | Generates signed FAA Part 89/107 forensic dossier (SHA-256) |
| `WS` | `/ws/telemetry` | 20 Hz WebSocket stream of tracks, radar blips, and LOBs |

---

## 📜 License
Developed for **Smart India Hackathon (SIH26247)**. Released under the MIT License.
