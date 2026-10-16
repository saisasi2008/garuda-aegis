import { useEffect, useMemo, useState } from 'react';
import { RadarPPI } from './components/RadarPPI';
import { TacticalMap3D } from './components/TacticalMap3D';
import { ThreatTable } from './components/ThreatTable';
import { JammerControl } from './components/JammerControl';
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

  // Legacy RF scan simulator state for spectrum waterfall
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

  const handleLockJammer = (track: FusedTrack) => {
    setSelectedTrackId(track.track_id);
    const dist = Math.hypot(track.position.x, track.position.y);
    const azDeg = (Math.atan2(track.position.y, track.position.x) * 180) / Math.PI;
    const elDeg = (Math.asin(Math.max(-1, Math.min(1, track.position.z / Math.max(dist, 1)))) * 180) / Math.PI;

    telemetryService.triggerJammer({
      azimuth_deg: Math.round(azDeg < 0 ? azDeg + 360 : azDeg),
      elevation_deg: Math.max(0, Math.round(elDeg)),
      power_w: 80,
      frequency_mhz: track.protocol.includes('915') ? 915 : 2440,
      bandwidth_mhz: 40,
      target_track_id: track.track_id,
    });
  };

  const primaryThreat = useMemo(() => threats[0] ?? null, [threats]);

  return (
    <main className="shell">
      {/* Top Header / C2 Status Banner */}
      <section className="hero panel" style={{ borderLeft: '4px solid #00f0ff' }}>
        <div>
          <p className="eyebrow">GARUDA-AEGIS (SIH26247) C-UAS DEFENSE SYSTEM</p>
          <h1 style={{ fontSize: '1.8rem', letterSpacing: '-0.02em', marginTop: '4px' }}>
            Multi-Sensor Fusion (UKF/GNN), Radar/RF Physics & EW Soft-Kill Jamming Console
          </h1>
          <div style={{ display: 'flex', gap: '16px', marginTop: '12px', fontSize: '12px', fontFamily: 'monospace' }}>
            <span style={{ color: isConnected ? '#00ffaa' : '#ffaa00' }}>
              ● TELEMETRY: {isConnected ? '20 Hz LIVE' : 'CONNECTING...'}
            </span>
            <span style={{ color: '#88a0b5' }}>FRAME: #{telemetry?.frame ?? 0}</span>
            <span style={{ color: '#00f0ff' }}>ACTIVE TRACKS: {tracks.length}</span>
            <span style={{ color: jammerStatus.is_active ? '#ff0055' : '#00ffaa', fontWeight: 'bold' }}>
              EW JAMMER: {jammerStatus.is_active ? 'TRANSMITTING' : 'STANDBY'}
            </span>
          </div>
        </div>

        <div className="hero-meta">
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setActiveTab('RADAR_3D')}
              style={{
                backgroundColor: activeTab === 'RADAR_3D' ? '#00f0ff' : '#102535',
                color: activeTab === 'RADAR_3D' ? '#060d15' : '#88a0b5',
                fontWeight: 'bold',
                border: 'none',
                padding: '6px 14px',
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
                backgroundColor: activeTab === 'RF_SPECTRUM' ? '#00f0ff' : '#102535',
                color: activeTab === 'RF_SPECTRUM' ? '#060d15' : '#88a0b5',
                fontWeight: 'bold',
                border: 'none',
                padding: '6px 14px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '11px',
              }}
            >
              RF SPECTRUM ANALYSIS
            </button>
          </div>
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#88a0b5' }}>
            RADAR RANGE:{' '}
            <select
              value={maxRangeM}
              onChange={(e) => setMaxRangeM(parseInt(e.target.value, 10))}
              style={{ backgroundColor: '#071624', color: '#00f0ff', border: '1px solid #1a324a', padding: '2px 6px' }}
            >
              <option value={1500}>1.5 km</option>
              <option value={2500}>2.5 km</option>
              <option value={4000}>4.0 km</option>
            </select>
          </div>
        </div>
      </section>

      {/* Main Dual Tactical Viewport */}
      {activeTab === 'RADAR_3D' ? (
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
          {/* Left: Polar Radar PPI Sweep */}
          <div className="panel stack-gap">
            <div className="section-heading">
              <span>Polar Radar PPI Sweep</span>
              <small>X-Band Pulse-Doppler / CFAR / Swerling 1 RCS</small>
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
              <small>WebGL 6-DOF Aerodynamics & EW Jammer Beam Cone</small>
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
        <section className="dashboard-grid" style={{ marginBottom: '20px' }}>
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

      {/* Lower Tactical Control & Table Grid */}
      <section style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr', gap: '20px' }}>
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
