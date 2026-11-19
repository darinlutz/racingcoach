'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { BRAKE_LIGHT_MESH, CAR_BODY_MESH, CAR_DETAIL_MESH, HEADLIGHT_MESH, WHEEL_MESH, WHEEL_RADIUS, WHEELS } from '@/lib/carModel3d';
import type { Bounds } from '@/lib/carModels/matrix';
import type { WheelAnchors } from '@/lib/carModels/modelRules';
import type { Mesh } from '@/lib/mesh3d';

// The generic GT3-class car of Lap Compare's 3D view (carModel3d.ts), drawn with three.js for the viewers when a car has
// no approved model: the same meshes, already in the canonical frame (+x forward, +y left, z up, on the ground)

const toGeometry = (mesh: Mesh) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mesh.attributes.positions.value, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(mesh.attributes.normals.value, 3));
  g.setAttribute('color', new THREE.BufferAttribute(mesh.attributes.colors.value, 3));
  return g;
};

export const GENERIC_BOUNDS: Bounds = (() => {
  const p = CAR_BODY_MESH.attributes.positions.value;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  }
  return { min: [min[0], min[1], 0], max };
})();

// Its wheel centers are its own, so they're exact for this drawing (it's labelled generic all the same)
export const GENERIC_WHEELS: WheelAnchors = (() => {
  const [lf, rf, lr, rr] = WHEELS;
  const at = (w: (typeof WHEELS)[number]) => ({ x: w.x, y: w.y, z: WHEEL_RADIUS, verified: true });
  return { LF: at(lf), RF: at(rf), LR: at(lr), RR: at(rr) };
})();

export default function GenericCar3D({ bodyColor = '#9aa3ad' }: { bodyColor?: string }) {
  const parts = useMemo(
    () => ({
      body: toGeometry(CAR_BODY_MESH),
      details: toGeometry(CAR_DETAIL_MESH),
      headlights: toGeometry(HEADLIGHT_MESH),
      brakeLights: toGeometry(BRAKE_LIGHT_MESH),
      wheel: toGeometry(WHEEL_MESH),
    }),
    []
  );
  return (
    <group>
      <mesh geometry={parts.body} castShadow>
        <meshStandardMaterial vertexColors color={bodyColor} metalness={0.3} roughness={0.35} />
      </mesh>
      <mesh geometry={parts.details}>
        <meshStandardMaterial vertexColors roughness={0.6} />
      </mesh>
      <mesh geometry={parts.headlights}>
        <meshBasicMaterial vertexColors color="#fff7de" />
      </mesh>
      <mesh geometry={parts.brakeLights}>
        <meshBasicMaterial vertexColors color="#691010" />
      </mesh>
      {WHEELS.map((w, i) => (
        <mesh key={i} geometry={parts.wheel} position={[w.x, w.y, WHEEL_RADIUS]} castShadow>
          <meshStandardMaterial vertexColors roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}
