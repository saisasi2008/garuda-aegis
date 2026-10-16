import React, { useState } from 'react';
import { JammerStatus, FusedTrack } from '../types';
import { telemetryService } from '../services/telemetrySocket';

interface JammerControlProps {
  jammerStatus: JammerStatus;
  selectedTrack?: FusedTrack | null;
}

export const JammerControl: React.FC<JammerControlProps> = ({ jammerStatus, selectedTrack }) => {
  const [azimuthDeg, setAzimuthDeg] = useState<number>(jammerStatus.aim_az_deg || 0);
  const [elevationDeg, setElevationDeg] = useState<number>(jammerStatus.aim_el_deg || 15);
  const [powerW, setPowerW] = useState<number>(jammerStatus.power_w || 75);
  const [freqMhz, setFreqMhz] = useState<number>(jammerStatus.freq_mhz || 2440);
  const [bandwidthMhz, setBandwidthMhz] = useState<number>(40);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleArmJammer = async () => {
    setIsSubmitting(true);
    try {
      await telemetryService.triggerJammer({
        azimuth_deg: azimuthDeg,
        elevation_deg: elevationDeg,
        power_w: powerW,
        frequency_mhz: freqMhz,
        bandwidth_mhz: bandwidthMhz,
        target_track_id: selectedTrack?.track_id ?? null,
      });
    } catch (err) {
      alert(`Jammer activation failed: ${err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisarmJammer = async () => {
    setIsSubmitting(true);
    try {
      await telemetryService.disarmJammer();
    } catch (err) {
      alert(`Jammer disarm failed: ${err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetSim = async () => {
    try {
      await telemetryService.resetSimulation();
    } catch (err) {
      alert(`Simulation reset failed: ${err}`);
    }
  };

  return (
    <div className="panel stack-gap">
      <div className="section-heading">
        <span>EW Directional RF Jammer Countermeasure</span>
        <small style={{ color: jammerStatus.is_active ? '#ff0055' : '#00ffaa' }}>
          {jammerStatus.is_active ? '● TRANSMITTING (SOFT-KILL ACTIVE)' : '○ STANDBY'}
        </small>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '12px', fontFamily: 'monospace' }}>
        <div>
          <label style={{ color: '#88a0b5' }}>AZIMUTH ({azimuthDeg}°):</label>
          <input
            type="range"
            min={0}
            max={360}
            value={azimuthDeg}
            onChange={(e) => setAzimuthDeg(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ color: '#88a0b5' }}>ELEVATION ({elevationDeg}°):</label>
          <input
            type="range"
            min={0}
            max={90}
            value={elevationDeg}
            onChange={(e) => setElevationDeg(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ color: '#88a0b5' }}>RF POWER ({powerW} W):</label>
          <input
            type="range"
            min={10}
            max={200}
            step={5}
            value={powerW}
            onChange={(e) => setPowerW(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ color: '#88a0b5' }}>TARGET FREQUENCY BAND:</label>
          <select
            value={freqMhz}
            onChange={(e) => setFreqMhz(parseFloat(e.target.value))}
            style={{
              width: '100%',
              backgroundColor: '#0c1a26',
              color: '#00f0ff',
              border: '1px solid #1a324a',
              padding: '4px',
              fontFamily: 'monospace',
            }}
          >
            <option value={2440}>2.4 GHz — DJI OcuSync 4</option>
            <option value={5800}>5.8 GHz — HD Downlink</option>
            <option value={915}>915 MHz — MAVLink Telemetry</option>
            <option value={868}>868 MHz — ExpressLRS FPV</option>
            <option value={433}>433 MHz — LoRa Long-Range</option>
          </select>
        </div>
      </div>

      {selectedTrack && (
        <div style={{ padding: '8px', backgroundColor: 'rgba(0, 240, 255, 0.08)', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' }}>
          LOCKED ON TARGET: <strong style={{ color: '#00f0ff' }}>{selectedTrack.track_id}</strong> |
          POS: ({selectedTrack.position.x.toFixed(0)}, {selectedTrack.position.y.toFixed(0)}, {selectedTrack.position.z.toFixed(0)})m |
          MICRO-DOPPLER: {selectedTrack.micro_doppler_hz.toFixed(0)} Hz
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
        <button
          onClick={handleArmJammer}
          disabled={isSubmitting}
          style={{
            flex: 2,
            backgroundColor: '#ff0044',
            color: '#fff',
            fontWeight: 'bold',
            padding: '10px',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          {jammerStatus.is_active ? 'UPDATE BEAM DIRECTION' : 'FIRE DIRECTIONAL JAMMER'}
        </button>

        <button
          onClick={handleDisarmJammer}
          disabled={!jammerStatus.is_active || isSubmitting}
          style={{
            flex: 1,
            backgroundColor: '#1a324a',
            color: '#88a0b5',
            padding: '10px',
            border: '1px solid #334d66',
            borderRadius: '4px',
            cursor: jammerStatus.is_active ? 'pointer' : 'not-allowed',
            fontFamily: 'monospace',
          }}
        >
          DISARM
        </button>

        <button
          onClick={handleResetSim}
          style={{
            flex: 1,
            backgroundColor: '#0a2233',
            color: '#00ffaa',
            border: '1px solid #00ffaa',
            padding: '10px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          RESET SIM
        </button>
      </div>
    </div>
  );
};
