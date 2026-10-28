// Satellite imagery under Lap Compare's track position maps (TrackLineMap). Tiles come from the provider
// in SATELLITE_TILE_URL, fetched by /api/map-tiles so its key stays on the server. The template has
// {z}, {x} and {y} placeholders, e.g. Esri World Imagery (the imagery iRacing's Lat/Lon was checked
// against): https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=<key>
// SATELLITE_ATTRIBUTION is the credit line the provider requires under the map.

// Most providers' satellite imagery stops here
export const MAX_TILE_ZOOM = 19;

const DEFAULT_ATTRIBUTION = 'Imagery: Esri, Maxar, Earthstar Geographics';

export function satelliteTileUrl(z: number, x: number, y: number): string | null {
  const template = process.env.SATELLITE_TILE_URL;
  if (!template) return null;
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

export function satelliteAttribution(): string | null {
  return process.env.SATELLITE_TILE_URL ? process.env.SATELLITE_ATTRIBUTION || DEFAULT_ATTRIBUTION : null;
}

// Google's Photorealistic 3D Tiles under Lap Compare's 3D view (TrackLineMap3D). Unlike the satellite tiles,
// the browser fetches them from Google itself (a 3D tileset is hundreds of files per view), so the key goes
// to signed-in users through /api/map-tiles and must be restricted in Google Cloud to the Map Tiles API and
// the site's own addresses (HTTP referrers). Unset, Lap Compare has no 3D view.
export function google3dTilesKey(): string | null {
  return process.env.GOOGLE_MAP_TILES_API_KEY || null;
}
