import React from 'react';
import { FusedTrack } from '../types';
import { telemetryService } from '../services/telemetrySocket';

interface ThreatTableProps {
  tracks: FusedTrack[];
  selectedTrackId?: string | null;
  onSelectTrack: (trackId: string) => void;
  onLockJammer: (track: FusedTrack) => void;
}

export const ThreatTable: React.FC<ThreatTableProps> = ({
  tracks,
  selectedTrackId,
  onSelectTrack,
  onLockJammer,
}) => {
  const handleDownloadDossier = async (trackId: string) => {
    try {
      const dossier = await telemetryService.getDossier(trackId);
      const blob = new Blob([JSON.stringify(dossier, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Forensic_Dossier_${trackId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Error fetching dossier for ${trackId}: ${err}`);
    }
  };

  return (
    <div className="panel stack-gap" style={{ overflowX: 'auto' }}>
      <div className="section-heading">
        <span>Active Airspace Threat Tracks ({tracks.length})</span>
        <small>Multi-Sensor UKF / Hungarian GNN Track Manager</small>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', fontFamily: 'monospace' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #1a324a', color: '#00f0ff', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>TRACK ID</th>
            <th style={{ padding: '8px' }}>STATUS</th>
            <th style={{ padding: '8px' }}>CLASSIFICATION</th>
            <th style={{ padding: '8px' }}>RANGE</th>
            <th style={{ padding: '8px' }}>ALTITUDE</th>
            <th style={{ padding: '8px' }}>SPEED</th>
            <th style={{ padding: '8px' }}>MICRO-DOPPLER</th>
            <th style={{ padding: '8px' }}>GNSS SPOOF</th>
            <th style={{ padding: '8px' }}>EW STATE</th>
            <th style={{ padding: '8px' }}>ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {tracks.length === 0 ? (
            <tr>
              <td colSpan={10} style={{ padding: '16px', textAlign: 'center', color: '#556b82' }}>
                Scanning airspace... No active target tracks currently in sensor coverage.
              </td>
            </tr>
          ) : (
            tracks.map((trk) => {
              const dist = Math.hypot(trk.position.x, trk.position.y);
              const isSelected = trk.track_id === selectedTrackId;

              return (
                <tr
                  key={trk.track_id}
                  onClick={() => onSelectTrack(trk.track_id)}
                  style={{
                    borderBottom: '1px solid #0d1e2e',
                    backgroundColor: isSelected ? 'rgba(0, 240, 255, 0.12)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <td style={{ padding: '8px', fontWeight: 'bold', color: '#00f0ff' }}>{trk.track_id}</td>
                  <td style={{ padding: '8px' }}>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontSize: '10px',
                        backgroundColor: trk.status === 'CONFIRMED' ? 'rgba(255, 40, 60, 0.25)' : 'rgba(255, 170, 0, 0.25)',
                        color: trk.status === 'CONFIRMED' ? '#ff2850' : '#ffaa00',
                      }}
                    >
                      {trk.status}
                    </span>
                  </td>
                  <td style={{ padding: '8px', color: trk.classification === 'HOSTILE_QUADCOPTER' ? '#ff3344' : '#88a0b5' }}>
                    {trk.classification}
                  </td>
                  <td style={{ padding: '8px' }}>{dist.toFixed(0)} m</td>
                  <td style={{ padding: '8px' }}>{trk.position.z.toFixed(0)} m</td>
                  <td style={{ padding: '8px' }}>{trk.velocity.speed_mps.toFixed(1)} m/s</td>
                  <td style={{ padding: '8px' }}>{trk.micro_doppler_hz.toFixed(0)} Hz</td>
                  <td style={{ padding: '8px' }}>
                    {trk.gnss_spoof_flag ? (
                      <span style={{ color: '#ff0055', fontWeight: 'bold' }}>SPOOFED (χ² &gt; 16.3)</span>
                    ) : (
                      <span style={{ color: '#00ffaa' }}>VALID</span>
                    )}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <span
                      style={{
                        color: trk.ew_status === 'MONITORING' ? '#556b82' : '#ffaa00',
                        fontWeight: trk.ew_status !== 'MONITORING' ? 'bold' : 'normal',
                      }}
                    >
                      {trk.ew_status}
                    </span>
                  </td>
                  <td style={{ padding: '8px' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onLockJammer(trk);
                      }}
                      style={{
                        backgroundColor: '#ff0044',
                        color: '#fff',
                        border: 'none',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        marginRight: '6px',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                      }}
                    >
                      JAM
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadDossier(trk.track_id);
                      }}
                      style={{
                        backgroundColor: '#1a324a',
                        color: '#00f0ff',
                        border: '1px solid #00f0ff',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                      }}
                    >
                      DOSSIER
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
