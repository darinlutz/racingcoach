'use client';

import { useEffect, useState } from 'react';
import { load } from '@loaders.gl/core';
import { GLTFLoader, postProcessGLTF } from '@loaders.gl/gltf';
import { paintInPlace, type GltfMaterial } from './modelPaint';

// A car's GLB for Lap Compare's deck.gl scene (TrackLineMap3D's ScenegraphLayer), loaded and post-processed once per
// address and kept for the page: both laps' cars, the ghost and the solid one, and every focus area share it, so a
// model is downloaded once however many cars show it. Same-origin only (/api/car-models/[id]/file), so the request
// carries the sign-in and needs nothing from the CSP. loaders.gl's GLTFLoader with no Draco or meshopt decoders: the
// upload check (glb.ts) refuses models that need them. Only the model's shape is drawn, in its lap's color: the page asks
// for the lighter copy (liteModelUrl), and whatever arrives is repainted here (modelPaint.ts), its images never decoded.

type Processed = ReturnType<typeof postProcessGLTF>;
const loaded = new Map<string, Promise<Processed>>();

export function loadDeckModel(url: string): Promise<Processed> {
  let promise = loaded.get(url);
  if (!promise) {
    promise = load(url, GLTFLoader, { gltf: { decompressMeshes: false, loadImages: false } }).then((gltf) => {
      const processed = postProcessGLTF(gltf);
      for (const material of (processed.materials ?? []) as unknown as GltfMaterial[]) paintInPlace(material);
      return processed;
    });
    promise.catch(() => loaded.delete(url));
    loaded.set(url, promise);
  }
  return promise;
}

export type DeckModelState = { status: 'idle' | 'loading' | 'failed' } | { status: 'ready'; scenegraph: Processed };

export function useDeckModel(url: string | null): DeckModelState {
  const [state, setState] = useState<{ url: string | null; value: DeckModelState }>({ url: null, value: { status: 'idle' } });
  useEffect(() => {
    if (!url) return;
    let live = true;
    loadDeckModel(url).then(
      (scenegraph) => live && setState({ url, value: { status: 'ready', scenegraph } }),
      (error) => {
        console.warn('Car model failed to load in the 3D view:', error);
        if (live) setState({ url, value: { status: 'failed' } });
      }
    );
    return () => {
      live = false;
    };
  }, [url]);
  if (!url) return { status: 'idle' };
  return state.url === url ? state.value : { status: 'loading' };
}
