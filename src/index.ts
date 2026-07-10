// geoedit: a standalone, framework-agnostic, client-side map editor for geospatial
// files (GeoJSON, KML, KMZ, GPX, TopoJSON, WKT), built on GeoJS.
//
// - editor.ts   the map UI + the createGeoEditor entry point
// - props.ts    byte-lossless GeoJSON edits (jsonc-parser)
// - xml-source.ts  byte-lossless KML/GPX edits (positional saxes splicer)
//
// The pure edit helpers are re-exported so they can be used headlessly (no map).
export {
  createGeoEditor,
  type GeoInput,
  type GeoEditorOptions,
  type GeoEditorHandle,
} from "./editor";
export { setLocale, t } from "./i18n";
export * from "./props";
export * from "./xml-source";
