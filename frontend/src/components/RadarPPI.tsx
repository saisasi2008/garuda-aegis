import React, { useEffect, useRef } from 'react';
import { FusedTrack, RadarDetection, RFBearing, JammerStatus } from '../types';

interface RadarPPIProps {
  tracks: FusedTrack[];
  detections: RadarDetection[];
  rfBearings: RFBearing[];
  jammerStatus: JammerStatus;
  maxRangeM?: number;
  onSelectTrack?: (trackId: string) => void;
  selectedTrackId?: string | null;
}

export const RadarPPI: React.FC<RadarPPIProps> = ({
  tracks,
  detections,
  rfBearings,
  jammerStatus,
  maxRangeM = 2500,
  onSelectTrack,
  selectedTrackId,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sweepAngleRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(cx, cy) - 25;

      // Clear with dark tactical background
      ctx.fillStyle = '#060d15';
      ctx.fillRect(0, 0, width, height);

      // Radar scope circle
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(7, 24, 34, 0.9)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#00f0ff';
      ctx.stroke();

      // Range rings
      const rings = 5;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.2)';
      ctx.fillStyle = 'rgba(0, 240, 255, 0.6)';
      ctx.font = '10px monospace';

      for (let i = 1; i <= rings; i++) {
        const r = (radius / rings) * i;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.stroke();

        const rangeVal = Math.round((maxRangeM / rings) * i);
        ctx.fillText(`${rangeVal}m`, cx + 4, cy - r + 12);
      }

      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.stroke();

      // Bearing azimuth ticks (every 30 deg)
      // Bearing azimuth ticks (every 30 deg, with 000° North at 12 o'clock)
      for (let deg = 0; deg < 360; deg += 30) {
        const rad = (deg * Math.PI) / 180;
        const x1 = cx + radius * Math.sin(rad);
        const y1 = cy - radius * Math.cos(rad);
        const x2 = cx + (radius - 8) * Math.sin(rad);
        const y2 = cy - (radius - 8) * Math.cos(rad);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const labelX = cx + (radius + 14) * Math.sin(rad);
        const labelY = cy - (radius + 14) * Math.cos(rad) + 4;
        let labelText = `${deg}°`;
        if (deg === 0) labelText = '000° N';
        else if (deg === 90) labelText = '090° E';
        else if (deg === 180) labelText = '180° S';
        else if (deg === 270) labelText = '270° W';
        ctx.fillText(labelText, labelX - 14, labelY);
      }

      // RF Direction Finder Line-of-Bearing (LOB) Strobes
      rfBearings.forEach((rf) => {
        const xStrobe = cx + radius * Math.cos(rf.az_rad);
        const yStrobe = cy - radius * Math.sin(rf.az_rad);

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(xStrobe, yStrobe);
        ctx.lineWidth = rf.gnss_spoof_flag ? 2 : 1.5;
        ctx.strokeStyle = rf.gnss_spoof_flag ? 'rgba(255, 40, 80, 0.6)' : 'rgba(255, 170, 0, 0.5)';
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label LOB protocol
        ctx.fillStyle = rf.gnss_spoof_flag ? '#ff2850' : '#ffaa00';
        ctx.fillText(
          rf.protocol,
          cx + (radius * 0.7) * Math.cos(rf.az_rad) + 5,
          cy - (radius * 0.7) * Math.sin(rf.az_rad)
        );
      });

      // Jammer cone beam pattern
      if (jammerStatus.is_active) {
        const canvasAimAngle = -((jammerStatus.aim_az_deg * Math.PI) / 180);
        const beamHalf = ((25 / 2) * Math.PI) / 180; // 25 deg beamwidth

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius * 0.95, canvasAimAngle - beamHalf, canvasAimAngle + beamHalf);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 0, 60, 0.25)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255, 0, 60, 0.8)';
        ctx.stroke();
      }

      // Raw Radar Detections (faint cyan blips)
      detections.forEach((det) => {
        const normDist = (det.range_m / maxRangeM) * radius;
        if (normDist <= radius) {
          const px = cx + normDist * Math.cos(det.az_rad);
          const py = cy - normDist * Math.sin(det.az_rad);

          ctx.beginPath();
          ctx.arc(px, py, 3, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(0, 240, 255, 0.5)';
          ctx.fill();
        }
      });

      // Active Fused Tracks
      tracks.forEach((trk) => {
        const dist = Math.sqrt(trk.position.x ** 2 + trk.position.y ** 2);
        const normDist = (dist / maxRangeM) * radius;
        if (normDist > radius + 20) return;

        const px = cx + (trk.position.x / maxRangeM) * radius;
        const py = cy - (trk.position.y / maxRangeM) * radius;

        const isSelected = trk.track_id === selectedTrackId;
        const isConfirmed = trk.status === 'CONFIRMED';
        const isSpoofed = trk.gnss_spoof_flag;

        // Target marker color
        let markerColor = '#00f0ff';
        if (isSpoofed) markerColor = '#ff0055';
        else if (isConfirmed) markerColor = '#ff3344';
        else markerColor = '#ffbb00';

        // Draw track icon
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeStyle = markerColor;
        ctx.beginPath();
        if (isConfirmed) {
          // Tactical diamond for confirmed hostile
          ctx.moveTo(px, py - 8);
          ctx.lineTo(px + 8, py);
          ctx.lineTo(px, py + 8);
          ctx.lineTo(px - 8, py);
          ctx.closePath();
        } else {
          // Circle for tentative track
          ctx.arc(px, py, 6, 0, 2 * Math.PI);
        }
        ctx.stroke();

        // Selection ring
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(px, py, 14, 0, 2 * Math.PI);
          ctx.strokeStyle = '#ffffff';
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Velocity vector leader line (2s forward prediction)
        const vx = trk.velocity.vx;
        const vy = trk.velocity.vy;
        const vScale = (radius / maxRangeM) * 3.0;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + vx * vScale, py - vy * vScale);
        ctx.strokeStyle = markerColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Target Tag Label
        ctx.font = '10px monospace';
        ctx.fillStyle = markerColor;
        ctx.fillText(trk.track_id, px + 12, py - 6);
        ctx.fillStyle = '#88a0b5';
        ctx.fillText(`${dist.toFixed(0)}m | ${trk.velocity.speed_mps.toFixed(1)}m/s`, px + 12, py + 6);
        if (isSpoofed) {
          ctx.fillStyle = '#ff0055';
          ctx.fillText('⚠ GNSS SPOOF', px + 12, py + 18);
        }
        if (trk.ew_status !== 'MONITORING') {
          ctx.fillStyle = '#ffaa00';
          ctx.fillText(`EW: ${trk.ew_status}`, px + 12, py + (isSpoofed ? 30 : 18));
        }
      });

      // Rotating Radar Sweep Line with Phosphor Gradient Fade
      sweepAngleRef.current = (sweepAngleRef.current + 0.035) % (2 * Math.PI);
      const sweepAngle = sweepAngleRef.current;

      const sweepGradient = ctx.createRadialGradient(cx, cy, 10, cx, cy, radius);
      sweepGradient.addColorStop(0, 'rgba(0, 255, 170, 0.4)');
      sweepGradient.addColorStop(1, 'rgba(0, 255, 170, 0.05)');

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, sweepAngle - 0.25, sweepAngle);
      ctx.closePath();
      ctx.fillStyle = sweepGradient;
      ctx.fill();

      // Sharp leading sweep edge
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + radius * Math.cos(sweepAngle), cy + radius * Math.sin(sweepAngle));
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#00ffaa';
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [tracks, detections, rfBearings, jammerStatus, maxRangeM, selectedTrackId]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !onSelectTrack) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const xClick = (e.clientX - rect.left) * scaleX;
    const yClick = (e.clientY - rect.top) * scaleY;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = Math.min(cx, cy) - 25;

    // Check proximity to any track
    for (const trk of tracks) {
      const px = cx + (trk.position.x / maxRangeM) * radius;
      const py = cy - (trk.position.y / maxRangeM) * radius;

      const dClick = Math.hypot(xClick - px, yClick - py);
      if (dClick < 22) {
        onSelectTrack(trk.track_id);
        return;
      }
    }
  };

  return (
    <div className="radar-ppi-container">
      <canvas
        ref={canvasRef}
        width={540}
        height={540}
        onClick={handleCanvasClick}
        style={{ cursor: 'crosshair', borderRadius: '8px', border: '1px solid #1a324a' }}
      />
    </div>
  );
};
