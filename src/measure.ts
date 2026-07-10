// Pure geodesic measurement helpers (no DOM), used by the measure tool.

const toRad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance in metres between two [lon, lat] points (haversine). */
export function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371008.8; // mean Earth radius (m)
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Total length in metres of a polyline of [lon, lat] points. */
export function pathLength(coords: number[][]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) {
    d += haversine(coords[i - 1] as [number, number], coords[i] as [number, number]);
  }
  return d;
}

/** Spherical area in m² of a polygon ring of [lon, lat] points (unsigned). */
export function ringArea(coords: number[][]): number {
  const n = coords.length;
  if (n < 3) return 0;
  const R = 6378137; // WGS84 semi-major axis (m)
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p1 = coords[i]!;
    const p2 = coords[(i + 1) % n]!;
    total += (toRad(p2[0]!) - toRad(p1[0]!)) * (2 + Math.sin(toRad(p1[1]!)) + Math.sin(toRad(p2[1]!)));
  }
  return Math.abs((total * R * R) / 2);
}

/** Human-readable distance (m / km). */
export function formatDistance(m: number): string {
  return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m";
}

/** Human-readable area (m² / km²). */
export function formatArea(m2: number): string {
  return m2 >= 1e6 ? (m2 / 1e6).toFixed(2) + " km²" : Math.round(m2) + " m²";
}

/** Format a [lon, lat] as "lat, lon" with 5 decimals. */
export function formatLonLat(lon: number, lat: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
