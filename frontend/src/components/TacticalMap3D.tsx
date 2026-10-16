import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { FusedTrack, JammerStatus } from '../types';

interface TacticalMap3DProps {
  tracks: FusedTrack[];
  jammerStatus: JammerStatus;
  selectedTrackId?: string | null;
  onSelectTrack?: (trackId: string) => void;
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
  const jammerConeRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x060c14);
    scene.fog = new THREE.FogExp2(0x060c14, 0.0004);

    // Camera
    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 10, 8000);
    camera.position.set(0, -1800, 1200);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 100);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    mount.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0x334455, 2.0);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0x00f0ff, 2.5);
    dirLight.position.set(500, -1000, 1500);
    scene.add(dirLight);

    // Ground Grid
    const grid = new THREE.GridHelper(4000, 40, 0x00f0ff, 0x11283a);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    // Defense Asset Safe-Zone Perimeter Ring at Origin (500m radius)
    const ringGeo = new THREE.RingGeometry(480, 500, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffaa, side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    scene.add(ringMesh);

    // Ground Station Center Beacon
    const beaconGeo = new THREE.CylinderGeometry(15, 25, 30, 16);
    const beaconMat = new THREE.MeshStandardMaterial({ color: 0x00ffaa, emissive: 0x008855, roughness: 0.3 });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.rotation.x = Math.PI / 2;
    beacon.position.set(0, 0, 15);
    scene.add(beacon);

    // Jammer Conical Beam Mesh
    const coneHeight = 2200;
    const coneRadius = Math.tan(THREE.MathUtils.degToRad(12.5)) * coneHeight; // 25 deg beam
    const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, 32, 1, true);
    coneGeo.translate(0, -coneHeight / 2, 0);
    coneGeo.rotateX(Math.PI); // Apex at (0, 0, 0), expanding along +Y
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xff0044,
      transparent: true,
      opacity: 0.22,
      wireframe: false,
      side: THREE.DoubleSide,
    });
    const jammerCone = new THREE.Mesh(coneGeo, coneMat);
    jammerCone.visible = false;
    scene.add(jammerCone);
    jammerConeRef.current = jammerCone;

    // Mouse Interaction (Orbiting)
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;
    let camRadius = 2200;
    let camTheta = -Math.PI / 2;
    let camPhi = Math.PI / 4;

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
      camPhi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, camPhi - dy * 0.005));

      camera.position.x = camRadius * Math.sin(camPhi) * Math.cos(camTheta);
      camera.position.y = camRadius * Math.sin(camPhi) * Math.sin(camTheta);
      camera.position.z = camRadius * Math.cos(camPhi);
      camera.lookAt(0, 0, 100);
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      camRadius = Math.max(400, Math.min(5000, camRadius + e.deltaY * 1.5));
      camera.position.x = camRadius * Math.sin(camPhi) * Math.cos(camTheta);
      camera.position.y = camRadius * Math.sin(camPhi) * Math.sin(camTheta);
      camera.position.z = camRadius * Math.cos(camPhi);
      camera.lookAt(0, 0, 100);
      e.preventDefault();
    };

    mount.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    mount.addEventListener('wheel', onWheel);

    // Animation Loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
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

  // Update Drones and Jammer in Scene
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const droneMeshes = droneMeshesRef.current;
    const activeTrackIds = new Set(tracks.map((t) => t.track_id));

    // Remove obsolete meshes
    for (const [id, group] of droneMeshes.entries()) {
      if (!activeTrackIds.has(id)) {
        scene.remove(group);
        droneMeshes.delete(id);
      }
    }

    // Add or update active tracks
    tracks.forEach((trk) => {
      let group = droneMeshes.get(trk.track_id);
      if (!group) {
        group = new THREE.Group();

        // 3D Quadcopter representation
        const bodyGeo = new THREE.OctahedronGeometry(18);
        const bodyMat = new THREE.MeshStandardMaterial({
          color: trk.gnss_spoof_flag ? 0xff0044 : 0x00f0ff,
          emissive: trk.gnss_spoof_flag ? 0xaa0022 : 0x004466,
          metalness: 0.8,
          roughness: 0.2,
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        group.add(body);

        // Vertical stem drop line to ground
        const stemGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0, -1),
        ]);
        const stemMat = new THREE.LineDashedMaterial({
          color: 0x00aaff,
          dashSize: 10,
          gapSize: 6,
          transparent: true,
          opacity: 0.6,
        });
        const stem = new THREE.Line(stemGeo, stemMat);
        stem.computeLineDistances();
        group.add(stem);

        scene.add(group);
        droneMeshes.set(trk.track_id, group);
      }

      // Update position
      group.position.set(trk.position.x, trk.position.y, trk.position.z);

      // Scale stem line to ground
      const stem = group.children[1] as THREE.Line;
      if (stem) {
        stem.scale.set(1, 1, trk.position.z);
      }

      // Highlight selected track
      const isSelected = trk.track_id === selectedTrackId;
      const body = group.children[0] as THREE.Mesh;
      if (body) {
        const mat = body.material as THREE.MeshStandardMaterial;
        mat.color.set(isSelected ? 0xffffff : trk.gnss_spoof_flag ? 0xff0044 : 0x00f0ff);
        body.scale.setScalar(isSelected ? 1.5 : 1.0);
      }
    });

    // Update Jammer Conical Beam
    const jammerCone = jammerConeRef.current;
    if (jammerCone) {
      if (jammerStatus.is_active) {
        jammerCone.visible = true;
        const azRad = THREE.MathUtils.degToRad(jammerStatus.aim_az_deg);
        const elRad = THREE.MathUtils.degToRad(jammerStatus.aim_el_deg);

        // Jammer antenna is mounted at origin (0, 0, 0)
        jammerCone.position.set(0, 0, 0);

        // Point cone along 3D aim vector
        const aimDir = new THREE.Vector3(
          Math.cos(elRad) * Math.cos(azRad),
          Math.cos(elRad) * Math.sin(azRad),
          Math.sin(elRad)
        ).normalize();

        jammerCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), aimDir);
      } else {
        jammerCone.visible = false;
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
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid #1a324a',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 12,
          color: '#00f0ff',
          fontFamily: 'monospace',
          fontSize: '11px',
          background: 'rgba(6, 12, 20, 0.75)',
          padding: '4px 8px',
          borderRadius: '4px',
          pointerEvents: 'none',
        }}
      >
        3D TACTICAL AIRSPACE (DRAG: ORBIT | SCROLL: ZOOM)
      </div>
    </div>
  );
};
