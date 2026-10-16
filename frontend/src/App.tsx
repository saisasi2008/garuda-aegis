import { useEffect, useMemo, useState } from 'react';
import { RadarPPI } from './components/RadarPPI';
import { TacticalMap3D } from './components/TacticalMap3D';
import { ThreatTable } from './components/ThreatTable';
import { JammerControl } from './components/JammerControl';
import { SensorTelemetryStrip } from './components/SensorTelemetryStrip';
import { SignalStrengthMeter } from './components/SignalStrengthMeter';
import { ThreatAlerts } from './components/ThreatAlerts';
import { WaterfallDisplay } from './components/WaterfallDisplay';
import { telemetryService } from './services/telemetrySocket';
import { TelemetryPayload, FusedTrack, Scan, Threat } from './types';

export default function App() {
  const [telemetry, setTelemetry] = useState<TelemetryPayload | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [maxRangeM, setMaxRangeM] = useState<number>(2500);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'RADAR_3D' | 'RF_SPECTRUM'>('RADAR_3D');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // RF scan simulator state for spectrum waterfall
  const [scan, setScan] = useState<Scan | null>(null);
  const [threats, setThreats] = useState<Threat[]>([]);

  useEffect(() => {
    // Subscribe to live 20 Hz Garuda-Aegis telemetry stream
    const unsubscribe = telemetryService.subscribe((data) => {
      setTelemetry(data);
      setIsConnected(true);

      // Auto-generate synthetic RF spectrum points for waterfall display based on intercepted emissions
      if (data.rf_bearings.length > 0) {
        const primaryRf = data.rf_bearings[0];
        const synthThreats: Threat[] = data.rf_bearings.map((b) => ({
          protocol: b.protocol,
          confidence: 0.96,
          estimated_distance_m: 1200,
          rssi_dbm: -65 + Math.random() * 5,
          last_seen: new Date().toISOString(),
          severity: b.gnss_spoof_flag ? 'CRITICAL' : 'HIGH',
          reason: b.threat_category,
          peaks: [{ frequency_mhz: b.frequency_mhz, power_db: 48.0 }],
        }));

        setThreats(synthThreats);
        setScan({
          captured_at: new Date().toISOString(),
          center_frequency_mhz: primaryRf.frequency_mhz,
          bandwidth_mhz: 40,
          noise_floor_db: -95,
          rssi_dbm: -65,
          spectrum: Array.from({ length: 64 }, (_, i) => -90 + (Math.abs(i - 32) < 6 ? 40 : Math.random() * 8)),
          peaks: data.rf_bearings.map((b) => ({ frequency_mhz: b.frequency_mhz, power_db: 45.0 })),
          bursts: [{ start_index: 28, end_index: 36, peak_power_db: 48.0 }],
          threats: synthThreats,
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const tracks = useMemo(() => telemetry?.tracks ?? [], [telemetry]);
  const radarDets = useMemo(() => telemetry?.radar_detections ?? [], [telemetry]);
  const rfBearings = useMemo(() => telemetry?.rf_bearings ?? [], [telemetry]);
  const sensors = useMemo(() => telemetry?.sensors, [telemetry]);
  const hasSpoofing = useMemo(() => tracks.some((t) => t.gnss_spoof_flag), [tracks]);

  const jammerStatus = useMemo(
    () =>
      telemetry?.jammer_status ?? {
        is_active: false,
        aim_az_deg: 0,
        aim_el_deg: 15,
        power_w: 50,
        freq_mhz: 2440,
        target_track_id: null,
      },
    [telemetry]
  );

  const selectedTrack = useMemo(() => {
    if (!selectedTrackId) return tracks[0] ?? null;
    return tracks.find((t) => t.track_id === selectedTrackId) ?? tracks[0] ?? null;
  }, [tracks, selectedTrackId]);

  // Operator Action Handlers
  const handleLockJammer = async (target?: FusedTrack | null) => {
    const trk = target || selectedTrack;
    if (!trk) {
      setActionMessage('⚠ No target selected to engage');
      setTimeout(() => setActionMessage(null), 3000);
      return;
    }
    setSelectedTrackId(trk.track_id);
    const dist = Math.hypot(trk.position.x, trk.position.y);
    const azDeg = (Math.atan2(trk.position.x, trk.position.y) * 180) / Math.PI; // Azimuth from North
    const normalizedAz = Math.round(azDeg < 0 ? azDeg + 360 : azDeg);
    const elDeg = (Math.asin(Math.max(-1, Math.min(1, trk.position.z / Math.max(dist, 1)))) * 180) / Math.PI;

    try {
      await telemetryService.triggerJammer({
        azimuth_deg: normalizedAz,
        elevation_deg: Math.max(0, Math.round(elDeg)),
        power_w: 80,
        frequency_mhz: trk.protocol.includes('915') ? 915 : 2440,
        bandwidth_mhz: 40,
        target_track_id: trk.track_id,
      });
      setActionMessage(`⚡ LOCK & JAM ENGAGED -> ${trk.track_id} (AZ: ${normalizedAz}°, EL: ${Math.round(elDeg)}°)`);
      setTimeout(() => setActionMessage(null), 4000);
    } catch (err) {
      setActionMessage(`❌ Jammer command failed: ${err}`);
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  const handleDisarmJammer = async () => {
    try {
      await telemetryService.disarmJammer();
      setActionMessage('⏹ EW JAMMER DISARMED -> TRANSMITTER IN STANDBY');
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err) {
      setActionMessage(`❌ Disarm failed: ${err}`);
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  const handleSpoofRedirect = async () => {
    try {
      await telemetryService.redirectSpoofed(45.0);
      setActionMessage('🛰️ GNSS SPOOF REDIRECT EMITTED: Course diversion +45.0° away from perimeter');
      setTimeout(() => setActionMessage(null), 4000);
    } catch (err) {
      setActionMessage(`❌ Spoof command failed: ${err}`);
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  const handleSpawnSwarm = async () => {
    try {
      await telemetryService.spawnSwarm(6);
      setActionMessage('🚀 MULTI-SECTOR SWARM SPAWNED: 6 Hostile UAVs (35°, 125°, 220°, 310°)');
      setTimeout(() => setActionMessage(null), 4000);
    } catch (err) {
      setActionMessage(`❌ Swarm spawn failed: ${err}`);
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  const handleResetSim = async () => {
    try {
      await telemetryService.resetSimulation();
      setActionMessage('🔄 SIMULATION RESET: Airspace cleared, defense initialized');
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err) {
      setActionMessage(`❌ Reset failed: ${err}`);
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  const primaryThreat = useMemo(() => threats[0] ?? null, [threats]);

  return (
    <main className="shell">
      {/* 1. Tactical C2 Command Header */}
      <section
        className="hero panel"
        style={{
          borderLeft: '4px solid #00f0ff',
          backgroundColor: 'rgba(5, 16, 26, 0.92)',
          padding: '20px 24px',
          marginBottom: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                backgroundColor: tracks.length > 0 ? '#ff0055' : '#00ffaa',
                color: '#fff',
                fontWeight: 'bold',
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '4px',
                fontFamily: 'monospace',
                letterSpacing: '0.08em',
              }}
            >
              {tracks.length > 0 ? 'DEFCON 2 // AIRSPACE ENGAGED' : 'DEFCON 4 // NOMINAL SURVEILLANCE'}
            </span>
            <p className="eyebrow" style={{ margin: 0, color: '#00f0ff', fontWeight: 600 }}>
              SIH26247 // MINISTRY OF DEFENCE C-UAS SPECIFICATION
            </p>
          </div>

          <h1
            style={{
              fontSize: '1.65rem',
              fontWeight: 800,
              letterSpacing: '-0.01em',
              margin: '6px 0 2px',
              color: '#ffffff',
            }}
          >
            GARUDA-AEGIS // TACTICAL AIR DEFENSE C2 CONSOLE
          </h1>

          <div style={{ color: '#88a0b5', fontSize: '11px', fontFamily: 'monospace' }}>
            INTEGRATED MULTI-SENSOR FUSION (UKF/GNN), SWERLING 1 RADAR/RF PHYSICS & DIRECTIONAL EW SOFT-KILL
          </div>

          <div style={{ display: 'flex', gap: '16px', marginTop: '10px', fontSize: '11px', fontFamily: 'monospace' }}>
            <span style={{ color: isConnected ? '#00ffaa' : '#ffaa00' }}>
              ● TELEMETRY: {isConnected ? '20 Hz LIVE' : 'CONNECTING...'}
            </span>
            <span style={{ color: '#88a0b5' }}>FRAME: #{telemetry?.frame ?? 0}</span>
            <span style={{ color: tracks.length > 0 ? '#ff3344' : '#00ffaa', fontWeight: 'bold' }}>
              TARGETS: {tracks.length} ACTIVE
            </span>
            <span style={{ color: hasSpoofing ? '#ff0055' : '#00ffaa' }}>
              GNSS INTEGRITY: {hasSpoofing ? '⚠ SPOOFING DETECTED' : 'NOMINAL (C/N₀ VALID)'}
            </span>
            <span style={{ color: jammerStatus.is_active ? '#ff0055' : '#00ffaa', fontWeight: 'bold' }}>
              EW JAMMER: {jammerStatus.is_active ? `TRANSMITTING (${jammerStatus.aim_az_deg}°)` : 'STANDBY'}
            </span>
          </div>
        </div>

        {/* Header Right Controls */}
        <div className="hero-meta" style={{ justifyContent: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setActiveTab('RADAR_3D')}
              style={{
                backgroundColor: activeTab === 'RADAR_3D' ? '#00f0ff' : '#0f2436',
                color: activeTab === 'RADAR_3D' ? '#060d15' : '#88a0b5',
                fontWeight: 'bold',
                border: '1px solid #1a3a52',
                padding: '7px 14px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '11px',
              }}
            >
              RADAR & 3D AIRSPACE
            </button>
            <button
              onClick={() => setActiveTab('RF_SPECTRUM')}
              style={{
                backgroundColor: activeTab === 'RF_SPECTRUM' ? '#00f0ff' : '#0f2436',
                color: activeTab === 'RF_SPECTRUM' ? '#060d15' : '#88a0b5',
                fontWeight: 'bold',
                border: '1px solid #1a3a52',
                padding: '7px 14px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '11px',
              }}
            >
              RF SPECTRUM ANALYSIS
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#88a0b5' }}>
            <span>RADAR RANGE:</span>
            <select
              value={maxRangeM}
              onChange={(e) => setMaxRangeM(parseInt(e.target.value, 10))}
              style={{
                backgroundColor: '#071624',
                color: '#00f0ff',
                border: '1px solid #1a324a',
                padding: '3px 8px',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '11px',
              }}
            >
              <option value={1500}>1.5 km (Inner Safe)</option>
              <option value={2500}>2.5 km (Tactical Tactical)</option>
              <option value={4000}>4.0 km (Long Range)</option>
            </select>
          </div>
        </div>
      </section>

      {/* 2. Operator Tactical Engagement Action Bar */}
      <section
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px',
          alignItems: 'center',
          backgroundColor: 'rgba(6, 18, 30, 0.88)',
          border: '1px solid #1a3a52',
          padding: '10px 16px',
          borderRadius: '8px',
          marginBottom: '14px',
          fontFamily: 'monospace',
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#00f0ff', marginRight: '6px' }}>
          ⚔️ OPERATOR ACTIONS:
        </span>

        <button
          onClick={() => handleLockJammer(selectedTrack)}
          style={{
            backgroundColor: '#ff0044',
            color: '#fff',
            border: 'none',
            padding: '6px 14px',
            borderRadius: '4px',
            fontWeight: 'bold',
            fontSize: '11px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          🎯 LOCK & JAM RF
        </button>

        <button
          onClick={handleSpoofRedirect}
          style={{
            backgroundColor: '#0f2f45',
            color: '#00f0ff',
            border: '1px solid #00f0ff',
            padding: '6px 14px',
            borderRadius: '4px',
            fontWeight: 'bold',
            fontSize: '11px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          🛰️ GNSS SPOOF REDIRECT
        </button>

        <button
          onClick={handleSpawnSwarm}
          style={{
            backgroundColor: '#162e24',
            color: '#00ffaa',
            border: '1px solid #00ffaa',
            padding: '6px 14px',
            borderRadius: '4px',
            fontWeight: 'bold',
            fontSize: '11px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          🚀 + SPAWN 6-DRONE SWARM
        </button>

        <button
          onClick={handleDisarmJammer}
          style={{
            backgroundColor: '#261c14',
            color: '#ffaa00',
            border: '1px solid #ffaa00',
            padding: '6px 14px',
            borderRadius: '4px',
            fontWeight: 'bold',
            fontSize: '11px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          ⏹ DISARM EW
        </button>

        <button
          onClick={handleResetSim}
          style={{
            backgroundColor: '#1b222c',
            color: '#88a0b5',
            border: '1px solid #334455',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '11px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            marginLeft: 'auto',
          }}
        >
          🔄 RESET SIM
        </button>

        {actionMessage && (
          <div
            style={{
              width: '100%',
              marginTop: '4px',
              fontSize: '11px',
              color: '#00ffaa',
              backgroundColor: 'rgba(0, 255, 170, 0.1)',
              padding: '4px 10px',
              borderRadius: '4px',
              borderLeft: '3px solid #00ffaa',
            }}
          >
            {actionMessage}
          </div>
        )}
      </section>

      {/* 3. 4-Sensor Pre-Fusion Telemetry Strip */}
      <SensorTelemetryStrip
        sensors={sensors}
        radarDetectionCount={radarDets.length}
        rfBearingCount={rfBearings.length}
        hasSpoofing={hasSpoofing}
        activeTrackCount={tracks.length}
      />

      {/* 4. Dual Tactical Viewport */}
      {activeTab === 'RADAR_3D' ? (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(420px, 1fr) minmax(420px, 1fr)',
            gap: '16px',
            marginBottom: '16px',
          }}
        >
          {/* Left: Polar Radar PPI Sweep */}
          <div className="panel stack-gap">
            <div className="section-heading">
              <span>Polar Radar PPI Sweep</span>
              <small>X-Band Pulse-Doppler / CFAR (Pfa=10⁻⁶) / Swerling 1 RCS</small>
            </div>
            <RadarPPI
              tracks={tracks}
              detections={radarDets}
              rfBearings={rfBearings}
              jammerStatus={jammerStatus}
              maxRangeM={maxRangeM}
              selectedTrackId={selectedTrackId}
              onSelectTrack={setSelectedTrackId}
            />
          </div>

          {/* Right: 3D Airspace Tactical Display */}
          <div className="panel stack-gap">
            <div className="section-heading">
              <span>3D Airspace Kinematics</span>
              <small>Three.js Y-Up / 6-DOF Aerodynamics & Directional EW Beam</small>
            </div>
            <TacticalMap3D
              tracks={tracks}
              jammerStatus={jammerStatus}
              selectedTrackId={selectedTrackId}
              onSelectTrack={setSelectedTrackId}
            />
          </div>
        </section>
      ) : (
        /* Alternate RF Spectrum & Waterfall View */
        <section className="dashboard-grid" style={{ marginBottom: '16px' }}>
          <section className="panel stack-gap wide-panel">
            <div className="section-heading">
              <span>RF Waterfall & Protocol Spectrogram</span>
              <small>Root-MUSIC Direction Finding & OcuSync / MAVLink Interception</small>
            </div>
            <WaterfallDisplay scan={scan} />
          </section>

          <ThreatAlerts threats={threats} />
          <SignalStrengthMeter primaryThreat={primaryThreat} rssiDbm={scan?.rssi_dbm ?? -110} />
        </section>
      )}

      {/* 5. Lower Section: Active Threat Tracks Table & Jammer Countermeasure */}
      <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
        <ThreatTable
          tracks={tracks}
          selectedTrackId={selectedTrackId}
          onSelectTrack={setSelectedTrackId}
          onLockJammer={handleLockJammer}
        />

        <JammerControl jammerStatus={jammerStatus} selectedTrack={selectedTrack} />
      </section>
    </main>
  );
}
