// Loose declarations for dependencies that ship no TypeScript types.
declare module "geojs" {
  const geo: any;
  export default geo;
}
declare module "topojson-client" {
  export function feature(topology: unknown, object: unknown): unknown;
}
declare module "wellknown" {
  export function parse(wkt: string): unknown;
  export function stringify(geometry: unknown): string;
}
declare module "shpjs" {
  // shp(zipOrShpBuffer) -> a GeoJSON FeatureCollection (or an array of them).
  const shp: (buffer: ArrayBuffer | Uint8Array) => Promise<unknown>;
  export default shp;
}
