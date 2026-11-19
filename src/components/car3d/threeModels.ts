'use client';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// The three.js side of the 3D car models (docs/car-models.md): each GLB loaded once per address and shared by every
// viewer on the page (each gets its own clone of the scene, sharing geometry, materials and textures), counted, and
// disposed of when the last viewer showing it goes, so its GPU memory is given back. No Draco or meshopt decoders are
// set: the upload check (glb.ts) refuses models that need them, so nothing is ever fetched from a CDN.

type Entry = { promise: Promise<THREE.Group>; refs: number; scene?: THREE.Group };
const models = new Map<string, Entry>();

export function acquireModel(url: string): Promise<THREE.Group> {
  let entry = models.get(url);
  if (!entry) {
    const loader = new GLTFLoader();
    const created: Entry = {
      refs: 0,
      promise: loader.loadAsync(url).then((gltf) => {
        created.scene = gltf.scene;
        return gltf.scene;
      }),
    };
    created.promise.catch(() => models.delete(url));
    models.set(url, created);
    entry = created;
  }
  entry.refs++;
  return entry.promise.then((scene) => scene.clone(true));
}

export function releaseModel(url: string) {
  const entry = models.get(url);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  models.delete(url);
  if (entry.scene) disposeObject(entry.scene);
}

export function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}

// A CSS color (a theme token such as --align-baseline, which may be oklch()) as three.js can use it: drawn on a
// one-pixel canvas and read back, as THREE.Color can't parse every CSS color
export function cssColor(variable: string, fallback: string): THREE.Color {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    if (!value) return new THREE.Color(fallback);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.Color(fallback);
    ctx.fillStyle = fallback;
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return new THREE.Color(r / 255, g / 255, b / 255).convertSRGBToLinear();
  } catch {
    return new THREE.Color(fallback);
  }
}

// Whether this browser can draw WebGL at all (turned off, blocked, no GPU): checked before a viewer mounts its canvas
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
