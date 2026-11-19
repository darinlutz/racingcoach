'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

// What CameraRig uses of drei's OrbitControls (makeDefault puts them in the store)
type OrbitControlsImpl = THREE.EventDispatcher<{ start: object }> & { target: THREE.Vector3; update(): void };
import { useLanguage } from '@/components/LanguageProvider';
import GenericCar3D, { GENERIC_BOUNDS, GENERIC_WHEELS } from '@/components/car3d/GenericCar3D';
import { acquireModel, cssColor, releaseModel, webglAvailable } from '@/components/car3d/threeModels';
import { useCarModel } from '@/lib/carModels/carModelClient';
import { CANONICAL_TO_THREE, canonicalBounds, normalizationMatrix, toThree, type Bounds, type Normalization, type Vec3 } from '@/lib/carModels/matrix';
import { CAMERA_VIEWS, CORNERS, type CameraView, type Corner, type ResolvedCarModel, type WheelAnchors } from '@/lib/carModels/modelRules';

// The interactive 3D car (docs/car-models.md), one component for every page that shows one: the Setups page's
// Suspension tab (Interactive 3D) and the Admin page's 3D Car Models preview. Lap Compare draws the same models in its
// own deck.gl scene (TrackLineMap3D), from the same approved asset, normalization and file.
//
// The car is the one asked for (by iRacing's car path, else its exact name) or an Admin's preview, loaded once per page
// and shared (threeModels.ts), placed in the canonical frame by its normalization (matrix.ts); without an approved
// model, the generic car, labelled as such. Drag to turn, scroll or pinch to zoom, right-drag to pan, within limits
// so the car can't be lost; seven camera presets and Reset; the four corners marked at the model's wheel-center
// anchors (never found by mesh names), which can be picked to move the camera there. A static exterior model: nothing
// moves, compresses or tilts, as no model here is rigged and no data says how it would. One WebGL context per viewer,
// rendered only when something changes (frameloop demand); a browser without WebGL, a lost context and a model that
// won't load each show a message rather than breaking the page. Loaded with next/dynamic (ssr false) by its pages.

export type Car3DViewerProps = {
  carKey?: string | null;
  carName?: string | null;
  // The Admin page's preview: any version, whatever its status, with its settings being edited
  preview?: ResolvedCarModel | null;
  normalization?: Normalization;
  wheelAnchors?: WheelAnchors;
  defaultView?: CameraView;
  selectedCorner?: Corner | null;
  onSelectCorner?: (corner: Corner) => void;
  showCorners?: boolean;
  showAxes?: boolean;
  showBounds?: boolean;
  enablePan?: boolean;
  className?: string;
  height?: number;
};

type Goal = { position: THREE.Vector3; target: THREE.Vector3; id: number };

const FOV = 35;
// Preset directions in the car's frame (+x forward, +y left, z up), the camera that way from the car's middle
const PRESET_DIRECTIONS: Record<CameraView, Vec3> = {
  frontThreeQuarter: [1, 0.85, 0.45],
  rearThreeQuarter: [-1, -0.85, 0.45],
  front: [1, 0, 0.18],
  rear: [-1, 0, 0.18],
  left: [0, 1, 0.12],
  right: [0, -1, 0.12],
  top: [0.0001, 0, 1],
};

const center = (b: Bounds): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
const radiusOf = (b: Bounds) => Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
const unit = ([x, y, z]: Vec3): Vec3 => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};
const v3 = (p: Vec3) => new THREE.Vector3(...toThree(p));

function presetGoal(view: CameraView, bounds: Bounds, id: number): Goal {
  const c = center(bounds);
  const d = unit(PRESET_DIRECTIONS[view]);
  const distance = (radiusOf(bounds) / Math.sin(((FOV / 2) * Math.PI) / 180)) * 1.05;
  return { position: v3([c[0] + d[0] * distance, c[1] + d[1] * distance, c[2] + d[2] * distance]), target: v3(c), id };
}

// Toward a corner from outside it, ahead of the front wheels or behind the rears, looking at its wheel center
function cornerGoal(anchor: { x: number; y: number; z: number }, bounds: Bounds, id: number): Goal {
  const d = unit([Math.sign(anchor.x) * 0.8, Math.sign(anchor.y) || 1, 0.55]);
  const distance = radiusOf(bounds) * 1.15;
  return { position: v3([anchor.x + d[0] * distance, anchor.y + d[1] * distance, anchor.z + d[2] * distance]), target: v3([anchor.x, anchor.y, anchor.z]), id };
}

// Eases the camera to its goal, then stops; a drag, zoom or pan by the user takes over at once
function CameraRig({ goal }: { goal: Goal }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);
  const moving = useRef(true);
  useEffect(() => {
    moving.current = true;
    invalidate();
  }, [goal, invalidate]);
  useEffect(() => {
    if (!controls) return;
    const stop = () => {
      moving.current = false;
    };
    controls.addEventListener('start', stop);
    return () => controls.removeEventListener('start', stop);
  }, [controls]);
  useFrame((_, dt) => {
    if (!moving.current || !controls) return;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 7);
    camera.position.lerp(goal.position, k);
    controls.target.lerp(goal.target, k);
    controls.update();
    if (camera.position.distanceTo(goal.position) < 0.005 && controls.target.distanceTo(goal.target) < 0.005) {
      camera.position.copy(goal.position);
      controls.target.copy(goal.target);
      controls.update();
      moving.current = false;
    }
    invalidate();
  });
  return null;
}

// The car's GLB under its normalization, a clone of the page's shared copy
function GlbCar({
  url,
  normalization,
  rawBounds,
  onFailed,
  onLoaded,
}: {
  url: string;
  normalization: Normalization;
  rawBounds: Bounds;
  onFailed: () => void;
  onLoaded: (url: string) => void;
}) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let live = true;
    acquireModel(url).then(
      (clone) => {
        if (!live) return;
        clone.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
        });
        setScene(clone);
        onLoaded(url);
        invalidate();
      },
      (error) => {
        console.warn('Car model failed to load:', error);
        if (live) onFailed();
      }
    );
    return () => {
      live = false;
      releaseModel(url);
    };
    // onFailed and onLoaded are the parent's setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, invalidate]);
  const matrix = useMemo(() => new THREE.Matrix4().fromArray(normalizationMatrix(normalization, rawBounds)), [normalization, rawBounds]);
  useEffect(() => invalidate(), [matrix, invalidate]);
  if (!scene) return null;
  return (
    <group matrixAutoUpdate={false} matrix={matrix}>
      <primitive object={scene} />
    </group>
  );
}

// A corner's name drawn in the scene (a sprite with its text on a small canvas), always facing the camera. Drawn by
// three.js rather than as DOM over the canvas, so it needs no portal and goes with the canvas when it unmounts
function CornerLabel({ text, on, highlight, position }: { text: string; on: boolean; highlight: THREE.Color; position: Vec3 }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = on ? `#${highlight.clone().convertLinearToSRGB().getHexString()}` : 'rgba(0, 0, 0, 0.65)';
    ctx.beginPath();
    ctx.roundRect(4, 4, 88, 40, 8);
    ctx.fill();
    ctx.fillStyle = on ? '#0b1220' : '#ffffff';
    ctx.font = 'bold 26px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 48, 25);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text, on, highlight]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={position} scale={[0.36, 0.18, 1]} renderOrder={10}>
      <spriteMaterial map={texture} depthTest={false} transparent />
    </sprite>
  );
}

function CornerMarkers({
  anchors,
  selected,
  onSelect,
  highlight,
  neutral,
}: {
  anchors: WheelAnchors;
  selected: Corner | null;
  onSelect?: (corner: Corner) => void;
  highlight: THREE.Color;
  neutral: THREE.Color;
}) {
  return (
    <>
      {CORNERS.map((corner) => {
        const a = anchors[corner];
        const on = corner === selected;
        return (
          // A ring round the wheel's axle (the car's y axis), at its center
          <group key={corner} position={[a.x, a.y, a.z]}>
            <mesh
              rotation={[Math.PI / 2, 0, 0]}
              onClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                onSelect?.(corner);
              }}
              onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                document.body.style.cursor = onSelect ? 'pointer' : '';
              }}
              onPointerOut={() => {
                document.body.style.cursor = '';
              }}
            >
              <torusGeometry args={[0.42, on ? 0.035 : 0.018, 12, 48]} />
              <meshBasicMaterial color={on ? highlight : neutral} transparent opacity={on ? 1 : 0.7} depthTest={false} />
            </mesh>
            <CornerLabel text={corner} on={on} highlight={highlight} position={[0, Math.sign(a.y) * 0.25, 0.62]} />
          </group>
        );
      })}
    </>
  );
}

// The canonical axes, for the Admin's normalization: red forward, green left, blue up
function Axes({ length }: { length: number }) {
  const arrows = useMemo(
    () =>
      (
        [
          [[1, 0, 0], 0xef4444],
          [[0, 1, 0], 0x22c55e],
          [[0, 0, 1], 0x3b82f6],
        ] as const
      ).map(([d, color]) => new THREE.ArrowHelper(new THREE.Vector3(...d), new THREE.Vector3(0, 0, 0.02), length, color, length * 0.12, length * 0.06)),
    [length]
  );
  return (
    <>
      {arrows.map((a, i) => (
        <primitive key={i} object={a} />
      ))}
    </>
  );
}

function BoundsBox({ bounds }: { bounds: Bounds }) {
  const c = center(bounds);
  const size: Vec3 = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]];
  return (
    <mesh position={c}>
      <boxGeometry args={size} />
      <meshBasicMaterial color="#facc15" wireframe transparent opacity={0.5} />
    </mesh>
  );
}

export default function Car3DViewer({
  carKey,
  carName,
  preview,
  normalization: normalizationOverride,
  wheelAnchors: anchorsOverride,
  defaultView,
  selectedCorner = null,
  onSelectCorner,
  showCorners = true,
  showAxes = false,
  showBounds = false,
  enablePan = true,
  className = '',
  height = 420,
}: Car3DViewerProps) {
  const { t, fmt } = useLanguage();
  const m = t.setups.carModels;
  const state = useCarModel({ carKey, carName }, preview);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [lost, setLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // The model whose GLB is in the scene, so the page (and its tests) can tell a loaded model from one still coming
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [colors, setColors] = useState<{ highlight: THREE.Color; neutral: THREE.Color; grid: THREE.Color } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measured once in the browser
    setWebgl(webglAvailable());
    setColors({
      highlight: cssColor('--align-baseline', '#22d3ee'),
      neutral: cssColor('--align-neutral', '#94a3b8'),
      grid: cssColor('--align-neutral', '#64748b'),
    });
  }, []);

  const model = state.status === 'ready' && state.model.url !== failedUrl ? state.model : null;
  const normalization = normalizationOverride ?? model?.normalization;
  const bounds = model && normalization ? canonicalBounds(normalization, model.rawBounds) : GENERIC_BOUNDS;
  const anchors = anchorsOverride ?? model?.wheelAnchors ?? GENERIC_WHEELS;
  const approximate = !!model && CORNERS.some((c) => !anchors[c].verified);
  const startView = defaultView ?? model?.defaultView ?? 'frontThreeQuarter';

  // The camera's goal: a preset, a corner, or where it opens; a new id moves it even to the same place
  const [goal, setGoal] = useState<Goal>(() => presetGoal(startView, bounds, 0));
  const [view, setView] = useState<CameraView | null>(startView);
  const goalId = useRef(0);
  const boundsKey = bounds.min.concat(bounds.max).map((v) => v.toFixed(3)).join();
  useEffect(() => {
    goalId.current++;
     
    setGoal(presetGoal(startView, bounds, goalId.current));
    setView(startView);
    // bounds is rebuilt each render; boundsKey is what it says
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey, startView]);
  const lastCorner = useRef<Corner | null>(selectedCorner);
  useEffect(() => {
    if (!selectedCorner || selectedCorner === lastCorner.current) return;
    lastCorner.current = selectedCorner;
    goalId.current++;
     
    setGoal(cornerGoal(anchors[selectedCorner], bounds, goalId.current));
    setView(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCorner]);

  const radius = radiusOf(bounds);
  const goTo = (next: CameraView) => {
    goalId.current++;
    setGoal(presetGoal(next, bounds, goalId.current));
    setView(next);
  };
  const toThreeMatrix = useMemo(() => new THREE.Matrix4().fromArray(CANONICAL_TO_THREE), []);
  const label = model ? model.carName : m.generic;
  const buttonClass =
    'px-2 py-1 rounded text-xs font-semibold whitespace-nowrap text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  const pressedClass = 'bg-primary/15 text-primary hover:text-primary';
  const panelClass = 'flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card/90 p-1 shadow';

  let message: string | null = null;
  if (webgl === false) message = m.noWebgl;
  else if (lost) message = m.contextLost;

  return (
    <figure className={`space-y-1 ${className}`}>
      <div
        className="relative overflow-hidden rounded-lg border border-border align-grid touch-none"
        style={{ height }}
        data-car3d={model ? (loadedUrl === model.url ? 'model' : 'loading') : 'generic'}
      >
        {message ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
            <p>{message}</p>
            {lost && (
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1 text-xs font-semibold text-foreground hover:border-primary"
                onClick={() => {
                  setLost(false);
                  setCanvasKey((k) => k + 1);
                }}
              >
                {m.retry}
              </button>
            )}
          </div>
        ) : webgl && colors ? (
          // The picture alone is the image; the controls over it stay buttons
          <div className="absolute inset-0" role="img" aria-label={fmt(m.viewerAria, { car: label })}>
          <Canvas
            key={canvasKey}
            frameloop="demand"
            dpr={[1, 2]}
            shadows
            gl={{ antialias: true, alpha: true }}
            camera={{ fov: FOV, near: 0.05, far: 300, position: goal.position.toArray() }}
            onCreated={({ gl }) => {
              gl.domElement.addEventListener('webglcontextlost', (event) => {
                event.preventDefault();
                setLost(true);
              });
            }}
          >
            <hemisphereLight args={['#dbe7ff', '#1b1f27', 0.9]} />
            <ambientLight intensity={0.35} />
            <directionalLight
              position={[6, 10, 5]}
              intensity={2.1}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-6}
              shadow-camera-right={6}
              shadow-camera-top={6}
              shadow-camera-bottom={-6}
            />
            <directionalLight position={[-6, 4, -6]} intensity={0.7} />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
              <planeGeometry args={[40, 40]} />
              <shadowMaterial transparent opacity={0.35} />
            </mesh>
            <Grid
              args={[30, 30]}
              cellSize={0.5}
              sectionSize={2.5}
              cellColor={colors.grid}
              sectionColor={colors.grid}
              cellThickness={0.5}
              sectionThickness={1}
              fadeDistance={radius * 7}
              infiniteGrid
            />
            <group matrixAutoUpdate={false} matrix={toThreeMatrix}>
              {model && normalization ? (
                <GlbCar url={model.url} normalization={normalization} rawBounds={model.rawBounds} onFailed={() => setFailedUrl(model.url)} onLoaded={setLoadedUrl} />
              ) : (
                <GenericCar3D />
              )}
              {showCorners && <CornerMarkers anchors={anchors} selected={selectedCorner} onSelect={onSelectCorner} highlight={colors.highlight} neutral={colors.neutral} />}
              {showAxes && <Axes length={Math.max(1, radius * 0.8)} />}
              {showBounds && <BoundsBox bounds={bounds} />}
            </group>
            <OrbitControls
              makeDefault
              enablePan={enablePan}
              enableDamping={false}
              minDistance={radius * 0.6}
              maxDistance={radius * 8}
              maxPolarAngle={Math.PI * 0.495}
            />
            <CameraRig goal={goal} />
          </Canvas>
          </div>
        ) : null}

        {state.status === 'loading' && !message && (
          <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground pointer-events-none">{m.loading}</p>
        )}

        {/* What's shown: the car (or the generic car), and whether its corners are approximate */}
        <div className="absolute left-2 top-2 flex max-w-[55%] flex-col items-start gap-1 pointer-events-none">
          <span className="rounded bg-black/60 px-2 py-0.5 text-xs font-semibold text-white" title={model ? undefined : m.genericTitle}>
            {label}
          </span>
          {model && preview && !(model.active && model.status === 'approved') && (
            <span className="rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-black">{m.preview}</span>
          )}
          {showCorners && approximate && (
            <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white" title={m.approximateTitle}>
              {m.approximate}
            </span>
          )}
        </div>

        {/* The camera presets along the bottom, so they never cover what's labelled at the top */}
        {!message && (
          <div className="absolute inset-x-2 bottom-2 flex justify-center">
            <div className={`${panelClass} justify-center`} role="group" aria-label={m.camera}>
              {CAMERA_VIEWS.map((v) => (
                <button key={v} type="button" aria-pressed={view === v} className={`${buttonClass} ${view === v ? pressedClass : ''}`} onClick={() => goTo(v)}>
                  {m.views[v]}
                </button>
              ))}
              <button type="button" className={buttonClass} onClick={() => goTo(startView)}>
                {m.resetCamera}
              </button>
            </div>
          </div>
        )}
        {!message && (
          <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
            {showCorners && onSelectCorner && (
              <div className={panelClass} role="group" aria-label={m.corner}>
                {CORNERS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={selectedCorner === c}
                    className={`${buttonClass} font-mono ${selectedCorner === c ? pressedClass : ''}`}
                    onClick={() => {
                      // Picking the same corner again still moves the camera back to it
                      lastCorner.current = null;
                      onSelectCorner(c);
                      if (selectedCorner === c) {
                        goalId.current++;
                        setGoal(cornerGoal(anchors[c], bounds, goalId.current));
                        setView(null);
                      }
                    }}
                  >
                    {m.corners[c]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        {failedUrl && `${m.failed} `}
        {state.status === 'error' && `${m.failed} `}
        {m.help}
        {model?.attribution && ` ${fmt(m.credit, { credit: model.attribution })}`}
      </figcaption>
    </figure>
  );
}
