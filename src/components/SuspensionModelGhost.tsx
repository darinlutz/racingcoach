'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { acquireModel, cssColor, releaseModel, webglAvailable } from '@/components/car3d/threeModels';
import { normalizationMatrix } from '@/lib/carModels/matrix';
import { liteModelUrl, type ResolvedCarModel } from '@/lib/carModels/modelRules';
import { modelToThree, VIEWBOX } from '@/lib/suspensionAxonometric';

// The compared car's 3D model behind the Suspension tab's axonometric overview (SuspensionCarOverview.tsx): its body
// see-through and its edges as faint lines, so the suspension drawn over it stays in view. Drawn through the
// overview's own projection (suspensionAxonometric.ts) with a camera spanning the drawing's viewBox, so it lines up
// with the wheels, springs and ground the SVG draws. Uses the lighter copy of the model (no interior, few primitives:
// glbLite.ts). Draws once when loaded, then again when its size or the theme changes; nothing animates. onReady says
// whether it drew, so the overview shows its schematic chassis instead when it can't (no WebGL, a failed load).
export default function SuspensionModelGhost({ model, onReady }: { model: ResolvedCarModel; onReady: (drawn: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const matrix = modelToThree(normalizationMatrix(model.normalization, model.rawBounds), model.wheelAnchors);
    if (!canvas || !matrix || !webglAvailable()) {
      onReady(false);
      return;
    }
    let live = true;
    const url = liteModelUrl(model.url);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const [vx, vy, vw, vh] = VIEWBOX;
    // The SVG's y runs down; three.js's up, so the viewBox's top edge is at -vy
    const camera = new THREE.OrthographicCamera(vx, vx + vw, -vy, -(vy + vh), 1, 20000);
    camera.position.set(0, 0, 10000);
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-0.4, 0.8, 1);
    scene.add(sun);

    const body = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
    const lines = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false });
    const created: THREE.BufferGeometry[] = [];
    const paint = () => {
      const color = cssColor('--align-line', '#8a94a3');
      body.color.copy(color);
      lines.color.copy(color);
    };
    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
    };

    let root: THREE.Group | null = null;
    acquireModel(url).then(
      (group) => {
        if (!live) return;
        root = group;
        group.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.material = body;
          // The model's outline: edges where its faces turn by more than 30 degrees
          const edges = new THREE.EdgesGeometry(mesh.geometry, 30);
          created.push(edges);
          mesh.add(new THREE.LineSegments(edges, lines));
        });
        // The model file's frame into the drawing's (its scene's own transforms kept under it)
        const holder = new THREE.Group();
        holder.matrixAutoUpdate = false;
        holder.matrix.fromArray(matrix);
        holder.add(group);
        scene.add(holder);
        scene.updateMatrixWorld(true);
        paint();
        draw();
        onReady(true);
      },
      (error) => {
        console.warn('The car model couldn’t be drawn in the suspension overview:', error);
        if (live) onReady(false);
      }
    );

    const resized = new ResizeObserver(() => draw());
    resized.observe(canvas);
    // Light and Dark Mode change the line color
    const themed = new MutationObserver(() => {
      paint();
      draw();
    });
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

    return () => {
      live = false;
      resized.disconnect();
      themed.disconnect();
      if (root) root.removeFromParent();
      releaseModel(url);
      for (const g of created) g.dispose();
      body.dispose();
      lines.dispose();
      renderer.dispose();
    };
  }, [model, onReady]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
