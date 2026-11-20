// How Lap Compare's 3D view paints a car's own model (docs/car-models.md): only the model's shape is used, and the car
// is drawn in its lap's color (the Target lap blue, the Compare lap red), whatever the model's livery. Every material
// loses its textures and becomes a plain grey that deck.gl's ScenegraphLayer multiplies by the lap's color (getColor):
// white for the bodywork, so it takes the lap's color in full, and dark for the parts that are dark on any car (tires,
// glass, carbon, black trim), so the car still reads as a car rather than one block of color. Pure, no I/O: the server's
// lite copy of the GLB (glbLite.ts) and the browser's loaded scenegraph (deckModel.ts) both use it.

// Parts named like these are drawn dark
const DARK_PART = /glass|window|windscreen|windshield|tyre|tire|rubber|carbon|black|interior|grille?|vent|exhaust|diffuser|splitter/i;
// A material whose own color is this dark (linear luminance) counts as a dark part too
const DARK_LUMINANCE = 0.06;

export const BODY_SHADE = 1;
export const DARK_SHADE = 0.14;

export type GltfMaterial = {
  name?: unknown;
  pbrMetallicRoughness?: { baseColorFactor?: unknown; [key: string]: unknown };
  alphaMode?: unknown;
  alphaCutoff?: unknown;
  doubleSided?: unknown;
  [key: string]: unknown;
};

// The grey (0-1) a material is painted with
export function paintShade(material: GltfMaterial): number {
  if (typeof material.name === 'string' && DARK_PART.test(material.name)) return DARK_SHADE;
  const factor = material.pbrMetallicRoughness?.baseColorFactor;
  if (Array.isArray(factor) && factor.length >= 3 && factor.slice(0, 3).every((v) => typeof v === 'number')) {
    const [r, g, b] = factor as number[];
    if (0.2126 * r + 0.7152 * g + 0.0722 * b < DARK_LUMINANCE) return DARK_SHADE;
  }
  return BODY_SHADE;
}

// The material as Lap Compare draws it: no textures, extensions or glow, its grey, a little gloss on the bodywork, and
// its own transparency (glass stays see-through)
export function paintedMaterial(material: GltfMaterial): GltfMaterial {
  const shade = paintShade(material);
  const factor = material.pbrMetallicRoughness?.baseColorFactor;
  const alpha = Array.isArray(factor) && typeof factor[3] === 'number' ? Math.min(1, Math.max(0, factor[3])) : 1;
  const out: GltfMaterial = {
    pbrMetallicRoughness: {
      baseColorFactor: [shade, shade, shade, alpha],
      metallicFactor: shade === BODY_SHADE ? 0.2 : 0,
      roughnessFactor: shade === BODY_SHADE ? 0.35 : 0.7,
    },
  };
  if (typeof material.name === 'string') out.name = material.name;
  if (material.alphaMode === 'BLEND' || material.alphaMode === 'MASK') out.alphaMode = material.alphaMode;
  if (material.alphaMode === 'MASK' && typeof material.alphaCutoff === 'number') out.alphaCutoff = material.alphaCutoff;
  if (material.doubleSided === true) out.doubleSided = true;
  return out;
}

// The same in place, on a loaded (loaders.gl post-processed) glTF's material objects, which its primitives point at
export function paintInPlace(material: GltfMaterial): void {
  const painted = paintedMaterial(material);
  for (const key of Object.keys(material)) {
    if (key !== 'id' && key !== 'name') delete material[key];
  }
  Object.assign(material, painted);
}
