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
  const pulseRef = useRef<number>(0);

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
      const radius = Math.min(cx, cy) - 28;

      pulseRef.current = (pulseRef.current + 0.05) % (2 * Math.PI);

      // 1. Dark tactical background
      ctx.fillStyle = '#050c15';
      ctx.fillRect(0, 0, width, height);

      // 2. Radar scope circular basin
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(6, 20, 32, 0.95)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#00f0ff';
      ctx.stroke();

      // 3. Concentric Range Rings & Labels
      const rings = 5;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.18)';
      ctx.fillStyle = 'rgba(0, 240, 255, 0.6)';
      ctx.font = '10px monospace';

      for (let i = 1; i <= rings; i++) {
        const r = (radius / rings) * i;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.stroke();

        const rangeVal = Math.round((maxRangeM / rings) * i);
        ctx.fillText(`${rangeVal}m`, cx + 6, cy - r + 12);
      }

      // Safe-zone 500m ring (highlighted in tactical green)
      const safeRadius = (500 / maxRangeM) * radius;
      if (safeRadius <= radius) {
        ctx.beginPath();
        ctx.arc(cx, cy, safeRadius, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(0, 255, 170, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = 'rgba(0, 255, 170, 0.6)';
        ctx.fillText('SAFE ZONE 500m', cx - 44, cy + safeRadius - 6);
      }

      // 4. Crosshairs (0°/180° and 90°/270°)
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.stroke();

      // 5. Bearing azimuth radial ticks & Cardinal Labels (000° N at 12 o'clock)
      for (let deg = 0; deg < 360; deg += 30) {
        const rad = (deg * Math.PI) / 180;
        const x1 = cx + radius * Math.sin(rad);
        const y1 = cy - radius * Math.cos(rad);
        const x2 = cx + (radius - 8) * Math.sin(rad);
        const y2 = cy - (radius - 8) * Math.cos(rad);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
        ctx.stroke();

        const labelX = cx + (radius + 14) * Math.sin(rad);
        const labelY = cy - (radius + 14) * Math.cos(rad) + 4;
        let labelText = `${deg.toString().padStart(3, '0')}°`;
        if (deg === 0) labelText = '000° N';
        else if (deg === 90) labelText = '090° E';
        else if (deg === 180) labelText = '180° S';
        else if (deg === 270) labelText = '270° W';

        ctx.fillStyle = deg % 90 === 0 ? '#00f0ff' : 'rgba(0, 240, 255, 0.55)';
        ctx.font = deg % 90 === 0 ? 'bold 10px monospace' : '9px monospace';
        ctx.fillText(labelText, labelX - 16, labelY);
      }

      // 6. Directional EW Jammer Beam Wedge (when active)
      if (jammerStatus.is_active) {
        // In screen coordinates: 000° is top (-Y), 090° is right (+X)
        // Screen angle = deg - 90 deg (in radians)
        const aimDeg = jammerStatus.aim_az_deg;
        const aimRad = ((aimDeg - 90) * Math.PI) / 180;
        const beamHalf = ((25 / 2) * Math.PI) / 180; // 25° beamwidth

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius * 0.98, aimRad - beamHalf, aimRad + beamHalf);
        ctx.closePath();

        // Pulsing jamming fill
        const jammerAlpha = 0.2 + 0.1 * Math.sin(pulseRef.current * 3);
        ctx.fillStyle = `rgba(255, 0, 68, ${jammerAlpha})`;
        ctx.fill();

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ff0044';
        ctx.stroke();

        // Animated Jamming Wavefronts
        for (let wave = 1; wave <= 3; wave++) {
          const waveRadius = ((radius * (pulseRef.current + wave * 0.6)) / 3) % (radius * 0.95);
          ctx.beginPath();
          ctx.arc(cx, cy, waveRadius, aimRad - beamHalf, aimRad + beamHalf);
          ctx.strokeStyle = `rgba(255, 80, 120, ${0.4 - (waveRadius / radius) * 0.35})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        ctx.restore();
      }

      // 7. RF Direction Finder Line-of-Bearing (LOB) Strobes
      rfBearings.forEach((rf) => {
        const lobCos = Math.cos(rf.az_rad);
        const lobSin = Math.sin(rf.az_rad);
        const xStrobe = cx + radius * lobCos;
        const yStrobe = cy - radius * lobSin;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(xStrobe, yStrobe);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rf.gnss_spoof_flag ? 'rgba(255, 0, 80, 0.7)' : 'rgba(255, 170, 0, 0.55)';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label LOB protocol & frequency at 72% radius
        const labelX = cx + (radius * 0.72) * lobCos;
        const labelY = cy - (radius * 0.72) * lobSin;
        ctx.fillStyle = rf.gnss_spoof_flag ? '#ff0055' : '#ffaa00';
        ctx.font = '9px monospace';
        ctx.fillText(`${rf.protocol} (${rf.frequency_mhz}MHz)`, labelX + 4, labelY - 4);
      });

      // 8. Raw Radar Pre-Fusion Detections (faint cyan blips)
      detections.forEach((det) => {
        const normDist = (det.range_m / maxRangeM) * radius;
        if (normDist <= radius) {
          // East = +X, North = -Y
          const px = cx + normDist * Math.cos(det.az_rad);
          const py = cy - normDist * Math.sin(det.az_rad);

          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(0, 240, 255, 0.55)';
          ctx.fill();
        }
      });

      // 9. Active Fused Target Tracks with Anti-Collision Staggered Leader Lines
      tracks.forEach((trk, index) => {
        const dist = Math.hypot(trk.position.x, trk.position.y);
        const normDist = (dist / maxRangeM) * radius;
        if (normDist > radius + 25) return;

        // Screen coordinates: px = East (+X), py = North (-Y)
        const px = cx + (trk.position.x / maxRangeM) * radius;
        const py = cy - (trk.position.y / maxRangeM) * radius;

        const isSelected = trk.track_id === selectedTrackId;
        const isConfirmed = trk.status === 'CONFIRMED';
        const isSpoofed = trk.gnss_spoof_flag;
        const isJammed = trk.ew_status !== 'MONITORING';

        // Target color coding
        let trackColor = '#00f0ff';
        if (isSpoofed) trackColor = '#ff0055';
        else if (isJammed) trackColor = '#ffaa00';
        else if (isConfirmed) trackColor = '#ff3344';

        // A. Velocity Vector Line (3s forward prediction)
        const vScale = (radius / maxRangeM) * 3.0;
        const vxScreen = trk.velocity.vx * vScale;
        const vyScreen = -trk.velocity.vy * vScale;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + vxScreen, py + vyScreen);
        ctx.strokeStyle = trackColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // B. Target Icon: Tactical Diamond for Confirmed, Circle for Tentative
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeStyle = trackColor;
        ctx.beginPath();
        if (isConfirmed) {
          ctx.moveTo(px, py - 9);
          ctx.lineTo(px + 9, py);
          ctx.lineTo(px, py + 9);
          ctx.lineTo(px - 9, py);
          ctx.closePath();
        } else {
          ctx.arc(px, py, 7, 0, 2 * Math.PI);
        }
        ctx.fillStyle = isSelected ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.5)';
        ctx.fill();
        ctx.stroke();

        // Center target pip
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, 2 * Math.PI);
        ctx.fillStyle = trackColor;
        ctx.fill();

        // C. Selected Target Reticle / Ring
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(px, py, 16, 0, 2 * Math.PI);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // D. Anti-Collision Staggered Leader Lines & Callout Badge
        // Calculate radial direction outward from radar center (cx, cy)
        const dx = px - cx;
        const dy = py - cy;
        const angleFromCenter = Math.atan2(dy, dx);

        // Stagger leader line length based on track index (26px, 44px, 62px, 80px)
        const staggerLengths = [26, 44, 62, 80];
        const leaderLen = staggerLengths[index % staggerLengths.length];

        const lx1 = px + Math.cos(angleFromCenter) * leaderLen;
        const ly1 = py + Math.sin(angleFromCenter) * leaderLen;

        // Dog-leg horizontal line: points right if target is in right hemisphere, left if in left
        const isRightSide = px >= cx;
        const dogLegLength = 20;
        const lx2 = lx1 + (isRightSide ? dogLegLength : -dogLegLength);
        const ly2 = ly1;

        // Draw leader line (Target -> lx1,ly1 -> lx2,ly2)
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(lx1, ly1);
        ctx.lineTo(lx2, ly2);
        ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(0, 240, 255, 0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // E. Sleek Tactical Callout Badge Box
        const badgeW = 96;
        const badgeH = 28;
        const badgeX = isRightSide ? lx2 + 2 : lx2 - badgeW - 2;
        const badgeY = ly2 - badgeH / 2;

        ctx.fillStyle = 'rgba(6, 16, 26, 0.9)';
        ctx.fillRect(badgeX, badgeY, badgeW, badgeH);

        ctx.lineWidth = 1;
        ctx.strokeStyle = isSelected ? '#ffffff' : trackColor;
        ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);

        // Callout Line 1: Track ID & Mini Status Tag
        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = isSelected ? '#ffffff' : trackColor;
        ctx.fillText(trk.track_id, badgeX + 4, badgeY + 11);

        // Mini status badge
        let statusBadge = 'HOSTILE';
        if (isSpoofed) statusBadge = 'SPOOF';
        else if (isJammed) statusBadge = 'JAMMED';
        else if (!isConfirmed) statusBadge = 'TENT';

        ctx.font = '8px monospace';
        ctx.fillStyle = isSpoofed ? '#ff0055' : isJammed ? '#ffaa00' : '#88a0b5';
        ctx.fillText(statusBadge, badgeX + 54, badgeY + 11);

        // Callout Line 2: Range & Speed
        ctx.font = '9px monospace';
        ctx.fillStyle = '#88a0b5';
        ctx.fillText(`${dist.toFixed(0)}m ${trk.velocity.speed_mps.toFixed(1)}m/s`, badgeX + 4, badgeY + 23);
      });

      // 10. Phosphor Radar Sweep Line & Fade Tail
      sweepAngleRef.current = (sweepAngleRef.current + 0.035) % (2 * Math.PI);
      const sweepAngle = sweepAngleRef.current;

      const sweepGradient = ctx.createRadialGradient(cx, cy, 10, cx, cy, radius);
      sweepGradient.addColorStop(0, 'rgba(0, 255, 170, 0.35)');
      sweepGradient.addColorStop(1, 'rgba(0, 255, 170, 0.03)');

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, sweepAngle - 0.28, sweepAngle);
      ctx.closePath();
      ctx.fillStyle = sweepGradient;
      ctx.fill();

      // Sharp sweep leading edge
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

  // Click on Canvas to Select Tracks
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
    const radius = Math.min(cx, cy) - 28;

    for (const trk of tracks) {
      const px = cx + (trk.position.x / maxRangeM) * radius;
      const py = cy - (trk.position.y / maxRangeM) * radius;

      const dClick = Math.hypot(xClick - px, yClick - py);
      if (dClick < 25) {
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
        style={{
          cursor: 'crosshair',
          borderRadius: '12px',
          border: '1px solid #1a3a52',
          background: '#050c15',
          display: 'block',
          width: '100%',
          maxWidth: '540px',
        }}
      />
    </div>
  );
};
