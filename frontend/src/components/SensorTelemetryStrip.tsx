import React from 'react';
import { SensorTelemetryStats } from '../types';

interface SensorTelemetryStripProps {
  sensors?: SensorTelemetryStats;
  radarDetectionCount: number;
  rfBearingCount: number;
  hasSpoofing: boolean;
  activeTrackCount: number;
}

export const SensorTelemetryStrip: React.FC<SensorTelemetryStripProps> = ({
  sensors,
  radarDetectionCount,
  rfBearingCount,
  hasSpoofing,
  activeTrackCount,
}) => {
  const radar = sensors?.radar_stats;
  const rf = sensors?.rf_stats;
  const gnss = sensors?.gnss_stats;
  const md = sensors?.micro_doppler_stats;

  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '12px',
        marginBottom: '16px',
      }}
    >
      {/* Sensor 1: X-Band 3D Radar */}
      <div
        className="panel"
        style={{
          padding: '10px 14px',
          borderLeft: '3px solid #00f0ff',
          backgroundColor: 'rgba(6, 16, 26, 0.85)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#00f0ff', letterSpacing: '0.05em' }}>
            🛰️ SENSOR 01 // 3D X-BAND RADAR
          </span>
          <span
            style={{
              fontSize: '10px',
              padding: '1px 5px',
              borderRadius: '2px',
              backgroundColor: 'rgba(0, 240, 255, 0.2)',
              color: '#00f0ff',
            }}
          >
            P_FA = 10⁻⁶
          </span>
        </div>
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#c5d8e8', fontFamily: 'monospace' }}>
          <div>
            FC: <strong style={{ color: '#fff' }}>{radar?.fc_ghz ?? 10.0} GHz</strong> | PT: 150W | CPI: {radar?.cpi_pulses ?? 64}
          </div>
          <div style={{ color: '#88a0b5', fontSize: '11px', marginTop: '2px' }}>
            CA-CFAR ADAPTIVE THRESHOLD // DETECTIONS: <strong style={{ color: '#00ffaa' }}>{radarDetectionCount}</strong>
          </div>
        </div>
      </div>

      {/* Sensor 2: Passive RF Direction Finder */}
      <div
        className="panel"
        style={{
          padding: '10px 14px',
          borderLeft: '3px solid #ffaa00',
          backgroundColor: 'rgba(6, 16, 26, 0.85)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#ffaa00', letterSpacing: '0.05em' }}>
            📡 SENSOR 02 // PASSIVE RF DF
          </span>
          <span
            style={{
              fontSize: '10px',
              padding: '1px 5px',
              borderRadius: '2px',
              backgroundColor: 'rgba(255, 170, 0, 0.2)',
              color: '#ffaa00',
            }}
          >
            ROOT-MUSIC 360°
          </span>
        </div>
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#c5d8e8', fontFamily: 'monospace' }}>
          <div>
            ARRAY: <strong style={{ color: '#fff' }}>8-ELEM ULA</strong> | INTERCEPTS: <strong style={{ color: '#ffaa00' }}>{rfBearingCount}</strong>
          </div>
          <div style={{ color: '#88a0b5', fontSize: '11px', marginTop: '2px' }}>
            PROTOCOLS: {rf?.active_protocols?.join(', ') || 'DJI OcuSync / MAVLink / ELRS'}
          </div>
        </div>
      </div>

      {/* Sensor 3: GNSS Spoofing Integrity Monitor */}
      <div
        className="panel"
        style={{
          padding: '10px 14px',
          borderLeft: `3px solid ${hasSpoofing ? '#ff0055' : '#00ffaa'}`,
          backgroundColor: 'rgba(6, 16, 26, 0.85)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 'bold', color: hasSpoofing ? '#ff0055' : '#00ffaa', letterSpacing: '0.05em' }}>
            🧭 SENSOR 03 // GNSS INTEGRITY
          </span>
          <span
            style={{
              fontSize: '10px',
              padding: '1px 5px',
              borderRadius: '2px',
              backgroundColor: hasSpoofing ? 'rgba(255, 0, 85, 0.25)' : 'rgba(0, 255, 170, 0.2)',
              color: hasSpoofing ? '#ff0055' : '#00ffaa',
              fontWeight: hasSpoofing ? 'bold' : 'normal',
            }}
          >
            {hasSpoofing ? '⚠ SPOOF DETECTED' : 'NOMINAL INTEGRITY'}
          </span>
        </div>
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#c5d8e8', fontFamily: 'monospace' }}>
          <div>
            GATE: χ²(3) &gt; {gnss?.gate_chi2 ?? 16.27} | ΔC/N₀ &gt; 6 dB
          </div>
          <div style={{ color: hasSpoofing ? '#ff0055' : '#88a0b5', fontSize: '11px', marginTop: '2px' }}>
            SPOOFED TARGETS DETECTED: <strong style={{ color: hasSpoofing ? '#ff0055' : '#00ffaa' }}>{gnss?.spoofed_count ?? (hasSpoofing ? 1 : 0)}</strong>
          </div>
        </div>
      </div>

      {/* Sensor 4: Micro-Doppler Rotor Classifier */}
      <div
        className="panel"
        style={{
          padding: '10px 14px',
          borderLeft: '3px solid #bb00ff',
          backgroundColor: 'rgba(6, 16, 26, 0.85)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#bb00ff', letterSpacing: '0.05em' }}>
            ⚡ SENSOR 04 // MICRO-DOPPLER
          </span>
          <span
            style={{
              fontSize: '10px',
              padding: '1px 5px',
              borderRadius: '2px',
              backgroundColor: 'rgba(187, 0, 255, 0.2)',
              color: '#d466ff',
            }}
          >
            ROTARY DISCRIMINATOR
          </span>
        </div>
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#c5d8e8', fontFamily: 'monospace' }}>
          <div>
            BLADE FLASH: <strong style={{ color: '#fff' }}>&gt;800 Hz (UAV)</strong> vs &lt;60 Hz (BIRD)
          </div>
          <div style={{ color: '#88a0b5', fontSize: '11px', marginTop: '2px' }}>
            ROTOR SPEED: ~{md?.mean_rpm ?? 5600} RPM | ACTIVE TRACKS: <strong style={{ color: '#00f0ff' }}>{activeTrackCount}</strong>
          </div>
        </div>
      </div>
    </section>
  );
};
