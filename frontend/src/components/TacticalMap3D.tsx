import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { FusedTrack, JammerStatus } from '../types';

interface TacticalMap3DProps {
  tracks: FusedTrack[];
  jammerStatus: JammerStatus;
  selectedTrackId?: string | null;
  onSelectTrack?: (trackId: string) => void;
}

// Helper to create a crisp canvas billboard sprite for drone callout tags
function createTextSprite(text: string, subText: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Semi-transparent background
    ctx.fillStyle = 'rgba(6, 16, 26, 0.88)';
    ctx.roundRect ? ctx.roundRect(4, 4, 248, 72, 8) : ctx.fillRect(4, 4, 248, 72);
    ctx.fill();

    // Border
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.roundRect ? ctx.roundRect(4, 4, 248, 72, 8) : ctx.strokeRect(4, 4, 248, 72);
    ctx.stroke();

    // Title / Track ID
    ctx.fillStyle = color;
    ctx.font = 'bold 24px monospace';
    ctx.fillText(text, 16, 32);

    // Subtext (Alt / Speed)
    ctx.fillStyle = '#88a0b5';
    ctx.font = '18px monospace';
    ctx.fillText(subText, 16, 60);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(160, 50, 1);
  return sprite;
}

export const TacticalMap3D: React.FC<TacticalMap3DProps> = ({
  tracks,
  jammerStatus,
  selectedTrackId,
  onSelectTrack,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const droneMeshesRef = useRef<Map<string, THREE.Group>>(new Map());
  const jammerGroupRef = useRef<THREE.Group | null>(null);
  const pulseAnimRef = useRef<number>(0);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // 1. Scene Setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x050c15);
    // Linear fog: clear up to 2500m, gradual fade to 7500m
    scene.fog = new THREE.Fog(0x050c15, 2000, 8000);

    // 2. Camera: Three.js standard Y-up coordinate system
    // Y = Altitude, X = East, Z = -North
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 10, 10000);
    camera.position.set(0, 1500, 2400);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 80, 0);

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0x334a60, 2.2);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0x00f0ff, 0x001824, 1.8);
    scene.add(hemiLight);

    const mainLight = new THREE.DirectionalLight(0x00f0ff, 2.8);
    mainLight.position.set(1200, 2500, 1500);
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xff0055, 1.2);
    fillLight.position.set(-1500, 1800, -1200);
    scene.add(fillLight);

    // 5. Tactical Ground Plane & Grids (Y = 0)
    // Primary Ground Grid (5000m span, 100m cells)
    const gridHelper = new THREE.GridHelper(5000, 50, 0x00f0ff, 0x0c2538);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    // Fine inner grid (1000m span, 25m cells)
    const innerGrid = new THREE.GridHelper(1000, 40, 0x00ffaa, 0x092e28);
    innerGrid.position.y = 0.5;
    scene.add(innerGrid);

    // Safe Zone Perimeter Ring (500m radius around Base)
    const safeZoneGeo = new THREE.RingGeometry(490, 505, 64);
    safeZoneGeo.rotateX(-Math.PI / 2);
    const safeZoneMat = new THREE.MeshBasicMaterial({
      color: 0x00ffaa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
    });
    const safeZoneMesh = new THREE.Mesh(safeZoneGeo, safeZoneMat);
    safeZoneMesh.position.y = 1;
    scene.add(safeZoneMesh);

    // Radar 1500m and 2500m Range Rings on Ground
    [1500, 2500].forEach((r) => {
      const ringGeo = new THREE.RingGeometry(r - 5, r + 5, 96);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00aaff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.25,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 1;
      scene.add(ring);
    });

    // 6. Base Station Defense Radome / Bunker at (0, 0, 0)
    const bunkerGroup = new THREE.Group();
    // Base platform
    const bunkerBase = new THREE.Mesh(
      new THREE.CylinderGeometry(40, 55, 15, 32),
      new THREE.MeshStandardMaterial({ color: 0x112233, metalness: 0.8, roughness: 0.3 })
    );
    bunkerBase.position.y = 7.5;
    bunkerGroup.add(bunkerBase);

    // Radar radome dome
    const radome = new THREE.Mesh(
      new THREE.SphereGeometry(25, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0x00ffaa,
        emissive: 0x004422,
        roughness: 0.2,
        metalness: 0.5,
        wireframe: true,
      })
    );
    radome.position.y = 15;
    bunkerGroup.add(radome);

    // Defense center beacon mast
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(2, 2, 60, 16),
      new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x0088aa })
    );
    mast.position.y = 45;
    bunkerGroup.add(mast);

    scene.add(bunkerGroup);

    // 7. Directional Jammer 3D Beam Assembly (Group originating at 0, 20, 0)
    const jammerGroup = new THREE.Group();
    jammerGroup.position.set(0, 20, 0);

    // Cone geometry: expanding along -Z, pointing towards target
    const coneLen = 2600;
    const coneRadius = Math.tan(THREE.MathUtils.degToRad(12.5)) * coneLen; // 25 deg beam
    const coneGeo = new THREE.ConeGeometry(coneRadius, coneLen, 36, 1, true);
    // Orient cone along -Z with apex at (0, 0, 0)
    coneGeo.translate(0, -coneLen / 2, 0);
    coneGeo.rotateX(Math.PI / 2);

    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xff0044,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const jammerCone = new THREE.Mesh(coneGeo, coneMat);
    jammerGroup.add(jammerCone);

    // Secondary wireframe cone for tactical grid look
    const wireConeMat = new THREE.MeshBasicMaterial({
      color: 0xff3366,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });
    const wireCone = new THREE.Mesh(coneGeo, wireConeMat);
    jammerGroup.add(wireCone);

    jammerGroup.visible = false;
    scene.add(jammerGroup);
    jammerGroupRef.current = jammerGroup;

    // 8. Orbit Controls via Mouse Drag & Scroll Wheel
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;
    let camRadius = 2600;
    let camTheta = 0.3; // Azimuth angle around Y
    let camPhi = 0.85; // Elevation angle from +Y (downwards)

    const updateCameraPos = () => {
      camera.position.x = camRadius * Math.sin(camPhi) * Math.sin(camTheta);
      camera.position.y = Math.max(150, camRadius * Math.cos(camPhi));
      camera.position.z = camRadius * Math.sin(camPhi) * Math.cos(camTheta);
      camera.lookAt(0, 100, 0);
    };
    updateCameraPos();

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouseX;
      const dy = e.clientY - prevMouseY;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;

      camTheta -= dx * 0.005;
      camPhi = Math.max(0.15, Math.min(Math.PI / 2 - 0.05, camPhi - dy * 0.005));
      updateCameraPos();
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      camRadius = Math.max(400, Math.min(6500, camRadius + e.deltaY * 1.5));
      updateCameraPos();
      e.preventDefault();
    };

    mount.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    mount.addEventListener('wheel', onWheel, { passive: false });

    // 9. Animation Render Loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      // Pulse jammer beam opacity if active
      pulseAnimRef.current += 0.06;
      if (jammerGroupRef.current && jammerGroupRef.current.visible) {
        coneMat.opacity = 0.18 + 0.12 * Math.sin(pulseAnimRef.current * 4);
      }

      // Rotate rotor discs on all active drone meshes
      droneMeshesRef.current.forEach((droneGroup) => {
        const rotorsGroup = droneGroup.getObjectByName('rotors');
        if (rotorsGroup) {
          rotorsGroup.children.forEach((rotor) => {
            rotor.rotation.y += 0.45;
          });
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      mount.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      mount.removeEventListener('wheel', onWheel);
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // 10. Update Active Drones and Jammer in Scene
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const droneMeshes = droneMeshesRef.current;
    const activeTrackIds = new Set(tracks.map((t) => t.track_id));

    // Remove obsolete drone meshes
    for (const [id, group] of droneMeshes.entries()) {
      if (!activeTrackIds.has(id)) {
        scene.remove(group);
        droneMeshes.delete(id);
      }
    }

    // Add or update active tracks
    tracks.forEach((trk) => {
      // Coordinate Mapping:
      // Simulator: px = East, py = North, pz = Altitude
      // Three.js Y-up: X = East, Y = Altitude, Z = -North
      const sceneX = trk.position.x;
      const sceneY = Math.max(10, trk.position.z);
      const sceneZ = -trk.position.y;

      let group = droneMeshes.get(trk.track_id);
      const isSelected = trk.track_id === selectedTrackId;
      const isSpoofed = trk.gnss_spoof_flag;
      const isJammed = trk.ew_status !== 'MONITORING';
      const themeColor = isSpoofed ? 0xff0055 : isJammed ? 0xffaa00 : 0x00f0ff;
      const themeColorHex = isSpoofed ? '#ff0055' : isJammed ? '#ffaa00' : '#00f0ff';

      if (!group) {
        group = new THREE.Group();
        group.name = trk.track_id;

        // A. Tactical Quadcopter Fuselage Body (span: 55m for high visibility at 2000m)
        const bodyGeo = new THREE.BoxGeometry(20, 8, 20);
        const bodyMat = new THREE.MeshStandardMaterial({
          color: themeColor,
          emissive: isSpoofed ? 0x660022 : 0x003344,
          metalness: 0.8,
          roughness: 0.2,
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.name = 'fuselage';
        group.add(body);

        // Center glowing dome / camera turret
        const turret = new THREE.Mesh(
          new THREE.SphereGeometry(6, 16, 16),
          new THREE.MeshBasicMaterial({ color: isSpoofed ? 0xff0044 : 0x00ffaa })
        );
        turret.position.y = 5;
        group.add(turret);

        // B. 4 Diagonal Carbon Fiber Arms
        const armLength = 50;
        const armMat = new THREE.MeshStandardMaterial({ color: 0x1a2b3c, metalness: 0.9, roughness: 0.3 });
        const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, armLength, 8), armMat);
        arm1.rotation.z = Math.PI / 2;
        arm1.rotation.y = Math.PI / 4;
        group.add(arm1);

        const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, armLength, 8), armMat);
        arm2.rotation.z = Math.PI / 2;
        arm2.rotation.y = -Math.PI / 4;
        group.add(arm2);

        // C. 4 Rotor Hubs & Spinning Discs
        const rotorsGroup = new THREE.Group();
        rotorsGroup.name = 'rotors';
        const rotorRadius = 14;
        const armOffset = (armLength / 2) * Math.SQRT1_2;

        const rotorPositions = [
          [armOffset, 4, armOffset],
          [-armOffset, 4, armOffset],
          [armOffset, 4, -armOffset],
          [-armOffset, 4, -armOffset],
        ];

        rotorPositions.forEach((pos) => {
          const rotorMesh = new THREE.Mesh(
            new THREE.RingGeometry(2, rotorRadius, 24),
            new THREE.MeshBasicMaterial({
              color: 0x00f0ff,
              side: THREE.DoubleSide,
              transparent: true,
              opacity: 0.55,
            })
          );
          rotorMesh.rotation.x = Math.PI / 2;
          rotorMesh.position.set(pos[0], pos[1], pos[2]);
          rotorsGroup.add(rotorMesh);
        });
        group.add(rotorsGroup);

        // D. Vertical Altitude Stem Line (from drone down to ground plane)
        const stemPoints = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0)];
        const stemGeo = new THREE.BufferGeometry().setFromPoints(stemPoints);
        const stemMat = new THREE.LineDashedMaterial({
          color: themeColor,
          dashSize: 12,
          gapSize: 8,
          transparent: true,
          opacity: 0.75,
        });
        const stemLine = new THREE.Line(stemGeo, stemMat);
        stemLine.name = 'stem';
        stemLine.computeLineDistances();
        group.add(stemLine);

        // E. Ground Footprint Projection Ring
        const groundFootprint = new THREE.Mesh(
          new THREE.RingGeometry(18, 22, 32),
          new THREE.MeshBasicMaterial({
            color: themeColor,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.65,
          })
        );
        groundFootprint.name = 'footprint';
        groundFootprint.rotation.x = Math.PI / 2;
        group.add(groundFootprint);

        // F. Velocity Vector Leader Line (3s forward projection)
        const velGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0, 0),
        ]);
        const velLine = new THREE.Line(
          velGeo,
          new THREE.LineBasicMaterial({ color: 0x00ffaa, linewidth: 2, transparent: true, opacity: 0.85 })
        );
        velLine.name = 'velVector';
        group.add(velLine);

        // G. 3D Billboard Callout Tag Sprite
        const sprite = createTextSprite(
          trk.track_id,
          `${sceneY.toFixed(0)}m | ${trk.velocity.speed_mps.toFixed(1)}m/s`,
          themeColorHex
        );
        sprite.name = 'tagSprite';
        sprite.position.set(0, 42, 0);
        group.add(sprite);

        scene.add(group);
        droneMeshes.set(trk.track_id, group);
      }

      // Update Drone Position
      group.position.set(sceneX, sceneY, sceneZ);

      // Update Altitude Stem Scale (drone Y down to ground Y=0)
      const stem = group.getObjectByName('stem') as THREE.Line;
      if (stem) {
        stem.scale.set(1, sceneY, 1);
        (stem.material as THREE.LineDashedMaterial).color.set(themeColor);
      }

      // Update Ground Footprint (anchored at Y = -sceneY relative to drone, so it sits on ground)
      const footprint = group.getObjectByName('footprint') as THREE.Mesh;
      if (footprint) {
        footprint.position.set(0, -sceneY + 1, 0);
        (footprint.material as THREE.MeshBasicMaterial).color.set(themeColor);
      }

      // Update Velocity Vector Leader Line
      const velLine = group.getObjectByName('velVector') as THREE.Line;
      if (velLine) {
        const vx3d = trk.velocity.vx * 3.0;
        const vy3d = trk.velocity.vz * 3.0; // vertical speed
        const vz3d = -trk.velocity.vy * 3.0; // north speed
        velLine.geometry.setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(vx3d, vy3d, vz3d)]);
      }

      // Update Fuselage appearance and selection scale
      const fuselage = group.getObjectByName('fuselage') as THREE.Mesh;
      if (fuselage) {
        const mat = fuselage.material as THREE.MeshStandardMaterial;
        mat.color.set(isSelected ? 0xffffff : themeColor);
        mat.emissive.set(isSelected ? 0x444444 : isSpoofed ? 0x660022 : 0x002233);
        group.scale.setScalar(isSelected ? 1.35 : 1.0);
      }

      // Update Billboard Sprite Tag
      const oldSprite = group.getObjectByName('tagSprite');
      if (oldSprite) {
        group.remove(oldSprite);
      }
      const newSprite = createTextSprite(
        isSelected ? `▶ ${trk.track_id} [SEL]` : trk.track_id,
        `ALT:${sceneY.toFixed(0)}m SPD:${trk.velocity.speed_mps.toFixed(1)}m/s`,
        isSelected ? '#ffffff' : themeColorHex
      );
      newSprite.name = 'tagSprite';
      newSprite.position.set(0, 48, 0);
      group.add(newSprite);
    });

    // 11. Update Directional Jammer Beam Cone in 3D Scene
    const jammerGroup = jammerGroupRef.current;
    if (jammerGroup) {
      if (jammerStatus.is_active) {
        jammerGroup.visible = true;

        // Azimuth in degrees (0 = North = -Z, 90 = East = +X, 180 = South = +Z, 270 = West = -X)
        const azRad = THREE.MathUtils.degToRad(jammerStatus.aim_az_deg);
        const elRad = THREE.MathUtils.degToRad(jammerStatus.aim_el_deg);

        // Calculate aim unit vector in Three.js Y-up system
        // East = +X, North = -Z, Altitude = +Y
        const dirX = Math.cos(elRad) * Math.sin(azRad);
        const dirY = Math.sin(elRad);
        const dirZ = -Math.cos(elRad) * Math.cos(azRad);
        const aimVector = new THREE.Vector3(dirX, dirY, dirZ).normalize();

        // Point jammer group towards target aim direction
        jammerGroup.lookAt(aimVector.clone().multiplyScalar(1000));
      } else {
        jammerGroup.visible = false;
      }
    }
  }, [tracks, jammerStatus, selectedTrackId]);

  return (
    <div
      ref={mountRef}
      style={{
        width: '100%',
        height: '540px',
        position: 'relative',
        borderRadius: '12px',
        overflow: 'hidden',
        border: '1px solid #1a3a52',
        background: '#050c15',
      }}
    >
      {/* 3D Viewport HUD Overlay Bar */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 14,
          color: '#00f0ff',
          fontFamily: 'monospace',
          fontSize: '11px',
          background: 'rgba(6, 16, 26, 0.85)',
          padding: '6px 12px',
          borderRadius: '4px',
          border: '1px solid #1a3a52',
          pointerEvents: 'none',
          display: 'flex',
          gap: '14px',
          alignItems: 'center',
        }}
      >
        <span>🌐 3D AIRSPACE (DRAG: ORBIT | WHEEL: ZOOM)</span>
        <span style={{ color: '#88a0b5' }}>|</span>
        <span style={{ color: '#00ffaa' }}>COORDINATES: THREE.JS Y-UP</span>
        <span style={{ color: '#88a0b5' }}>|</span>
        <span style={{ color: jammerStatus.is_active ? '#ff0055' : '#88a0b5' }}>
          EW BEAM: {jammerStatus.is_active ? `ACTIVE (${jammerStatus.aim_az_deg}°) ` : 'OFF'}
        </span>
      </div>
    </div>
  );
};
