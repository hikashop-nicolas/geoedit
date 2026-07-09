import geo from "geojs";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { kml as kmlToGeo, gpx as gpxToGeo } from "@tmcw/togeojson";
import { feature as topoFeature } from "topojson-client";
import { parse as parseWkt } from "wellknown";
import {
  applyPropertyEdit,
  coerceScalar,
  deleteFeature,
  deleteProperty,
  insertFeature,
  setGeometryCoords,
} from "./props";
import {
  parseXmlGeo,
  setXmlField,
  deleteXmlFeature,
  insertXmlFeature,
  setKmlGeometry,
  setGpxWptCoord,
  buildKmlFeature,
  buildGpxFeature,
  buildKmlDocument,
  buildGpxDocument,
  firstCoordOfGeometry,
  featureKey,
  type XmlModel,
  type XmlFeature,
} from "./xml-source";
// geoedit: a standalone, framework-agnostic, client-side map editor for geospatial
// files (GeoJSON, KML, KMZ, GPX, TopoJSON, WKT), built on GeoJS.
//
// It projects the file to a throwaway GeoJSON FeatureCollection for display (togeojson
// for KML/GPX); the source text is held verbatim so getText() round-trips byte-for-byte.
// Edits are applied straight into the source (jsonc-parser for GeoJSON, a positional
// saxes splicer for KML/GPX) so only the changed span is rewritten. TopoJSON/WKT are
// view-only (export them to an editable format). Features draw on an OSM basemap: only
// tile requests (z/x/y) leave the browser, never any file data.

/** Input document for the editor. Pass `text` for text formats, `bytes` for .kmz. */
export interface GeoInput {
  text?: string;
  bytes?: Uint8Array;
  filename?: string;
}

export interface GeoEditorOptions {
  /** Override the auto-detected file name (used to name exported files). */
  filename?: string;
  /** Force editability on/off; by default it is inferred from the format. */
  editable?: boolean;
  /** Called after every edit that changes the document. */
  onChange?: () => void;
  /** Called to save/share an exported file. Defaults to a browser download. */
  onExport?: (name: string, bytes: Uint8Array) => void;
  /** Called on a recoverable error. Defaults to console.error. */
  onError?: (message: string) => void;
}

export interface GeoEditorHandle {
  /** Current document as text (for text formats). */
  getText(): string;
  /** Current document as bytes (.kmz), else undefined. */
  getBytes(): Uint8Array | undefined;
  /** Tear down the map and remove the DOM. */
  destroy(): void;
}

const STYLE_ID = "geoedit-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ge { display:flex; flex-direction:column; height:100%; overflow:hidden;
      background:var(--canvas,#e9eef2); }
    .ge-toolbar { display:flex; align-items:center; gap:6px; padding:6px 8px;
      border-bottom:1px solid var(--border,rgba(0,0,0,.12)); background:var(--chrome,#f6f7f9);
      flex:0 0 auto; }
    .ge-tool { display:inline-flex; align-items:center; justify-content:center;
      width:30px; height:30px; padding:0; border-radius:6px; cursor:pointer;
      border:1px solid var(--border,rgba(0,0,0,.18)); background:var(--canvas,#fff);
      color:inherit; }
    .ge-tool svg { display:block; }
    .ge-tool:hover { border-color:var(--accent,#2563eb); color:var(--accent,#2563eb); }
    .ge-tool.is-active { background:var(--accent,#2563eb); border-color:transparent;
      color:#fff; }
    .ge-canvas { position:relative; flex:1 1 auto; overflow:hidden; }
    .ge .geojs-map { height:100%; }
    .ge-side { position:absolute; top:0; right:0; bottom:0; width:260px; max-width:80%;
      display:flex; flex-direction:column; background:var(--bg,#fff); color:var(--text,#1c1e21);
      border-left:1px solid var(--border,#e4e6eb); box-shadow:-4px 0 16px rgba(0,0,0,.14);
      z-index:6; }
    .ge-side-head { display:flex; align-items:center; justify-content:space-between;
      padding:8px 10px; border-bottom:1px solid var(--border,#e4e6eb); font-weight:600;
      font:600 13px system-ui, sans-serif; }
    .ge-side-head .ge-close { position:static; }
    .ge-side-body { flex:1 1 auto; overflow:auto; padding:10px; }
    .ge-export { display:flex; flex-direction:column; gap:6px; }
    .ge-export .ge-btn { width:100%; }
    .ge-list { display:flex; flex-direction:column; gap:8px; height:100%; }
    .ge-list-filter { box-sizing:border-box; width:100%; font:inherit; padding:5px 8px;
      border:1px solid var(--border,#e4e6eb); border-radius:6px; background:var(--canvas,#fff); color:var(--text,#1c1e21); }
    .ge-list-items { flex:1 1 auto; overflow:auto; display:flex; flex-direction:column; gap:1px; }
    .ge-litem { display:flex; align-items:center; gap:4px; }
    .ge-litem-name { flex:1 1 auto; text-align:left; background:none; border:0; cursor:pointer;
      color:var(--text,#1c1e21); font:13px system-ui, sans-serif; padding:5px 6px; border-radius:5px;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ge-litem-name:hover { background:var(--surface-hover,#e8eaed); }
    .ge-editbar { position:absolute; left:50%; bottom:16px; transform:translateX(-50%);
      display:flex; align-items:center; gap:8px; padding:8px 12px; border-radius:8px;
      background:var(--bg,#fff); color:var(--text,#1c1e21); border:1px solid var(--border,#e4e6eb);
      box-shadow:0 4px 16px rgba(0,0,0,.28); font:12px/1.4 system-ui, sans-serif; z-index:5; }
    .ge-msg { position:absolute; inset:0; display:flex; align-items:center;
      justify-content:center; color:var(--muted,#667); padding:24px;
      font:14px system-ui, sans-serif; text-align:center; }
    .ge-props { position:absolute; left:0; top:0; width:250px; max-width:70%;
      max-height:70%; overflow:auto; background:var(--bg,#fff); color:var(--text,#1c1e21);
      border:1px solid var(--border,#e4e6eb); border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,.28);
      padding:10px 12px; font:12px/1.5 system-ui, sans-serif; display:none; }
    .ge-props.is-open { display:block; }
    .ge-props h4 { margin:0 26px 8px 0; font-size:12px; font-weight:600; color:var(--text,#1c1e21); }
    .ge-row { display:grid; grid-template-columns:auto 1fr; gap:3px 8px;
      align-items:center; margin-bottom:4px; }
    .ge-row.has-del { grid-template-columns:auto 1fr auto; }
    .ge-row label { color:var(--muted,#6b7280); white-space:nowrap; }
    .ge-row .ge-ro { word-break:break-word; }
    .ge-rowdel { background:none; border:0; cursor:pointer; color:var(--muted,#6b7280);
      font-size:15px; line-height:1; padding:0 2px; }
    .ge-rowdel:hover { color:#e5534b; }
    .ge-addprop { display:grid; grid-template-columns:1fr 1fr auto; gap:4px;
      margin-top:6px; padding-top:6px; border-top:1px solid var(--border,#e4e6eb); }
    .ge-addprop input { min-width:0; box-sizing:border-box; font:inherit; padding:3px 6px;
      border:1px solid var(--border,#e4e6eb); border-radius:4px; background:var(--canvas,#fff); color:var(--text,#1c1e21); }
    .ge-addprop .ge-btn { padding:2px 8px; }
    .ge-props input { width:100%; box-sizing:border-box; font:inherit;
      padding:3px 6px; border:1px solid var(--border,#e4e6eb); border-radius:4px;
      background:var(--canvas,#fff); color:var(--text,#1c1e21); }
    .ge-props input:focus { outline:none; border-color:var(--accent,#4f46e5); }
    .ge-props .ge-close { position:absolute; top:6px; right:8px; cursor:pointer;
      color:var(--muted,#6b7280); font-size:16px; line-height:1; background:none; border:0; }
    .ge-props .ge-hint { color:var(--muted,#6b7280); margin-top:6px; font-size:11px; }
    .ge-actions { display:flex; gap:6px; margin-top:10px; }
    .ge-btn { font:inherit; padding:4px 12px; border-radius:5px; cursor:pointer;
      border:1px solid var(--border,#e4e6eb); background:var(--surface,#f1f2f4); color:var(--text,#1c1e21); }
    .ge-btn:hover { background:var(--surface-hover,#e8eaed); }
    .ge-btn.ge-primary { background:var(--accent,#4f46e5); border-color:transparent;
      color:var(--accent-fg,#fff); }
    .ge-btn.ge-danger { margin-top:10px; color:#e5534b; background:transparent;
      border-color:rgba(229,83,75,.5); }
    .ge-btn.ge-danger:hover { background:rgba(229,83,75,.12); }
  `;
  document.head.appendChild(s);
}

interface GeoJsonGeometry {
  type: string;
  coordinates?: unknown;
  geometries?: GeoJsonGeometry[];
}
interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties?: Record<string, unknown> | null;
  /** In-memory index into the GeoJSON source features array (rendering only). */
  __idx?: number;
  /** In-memory index into the XML source model's features (KML/GPX), or -1 if unmatched. */
  __srcIdx?: number;
}
interface FeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

type GeoKind = "geojson" | "kml" | "gpx" | "topojson" | "wkt";

const WKT_RE = /^\s*(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\s*[ZM]*\s*[(]/i;

function detectKind(text: string, filename: string): GeoKind {
  const name = filename.toLowerCase();
  if (name.endsWith(".gpx") || /<gpx[\s>]/i.test(text)) return "gpx";
  if (name.endsWith(".kml") || /<kml[\s>]/i.test(text)) return "kml";
  if (name.endsWith(".topojson") || /"type"\s*:\s*"Topology"/.test(text)) return "topojson";
  if (name.endsWith(".wkt") || WKT_RE.test(text)) return "wkt";
  return "geojson";
}

// Project the source to a FeatureCollection GeoJS can read.
function toFeatureCollection(text: string, kind: GeoKind): FeatureCollection {
  if (kind === "kml" || kind === "gpx") {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const conv = kind === "gpx" ? gpxToGeo : kmlToGeo;
    return conv(doc) as unknown as FeatureCollection;
  }
  if (kind === "topojson") return topojsonToFc(text);
  if (kind === "wkt") return wktToFc(text);
  return normalizeGeoJson(JSON.parse(text));
}

// TopoJSON -> FeatureCollection (all objects flattened), via topojson-client.
function topojsonToFc(text: string): FeatureCollection {
  const topo = JSON.parse(text) as { objects?: Record<string, unknown> };
  const features: GeoJsonFeature[] = [];
  for (const key of Object.keys(topo.objects ?? {})) {
    const geo = topoFeature(topo as any, (topo.objects as any)[key]) as {
      type: string;
      features?: GeoJsonFeature[];
    };
    if (geo.type === "FeatureCollection" && geo.features) features.push(...geo.features);
    else features.push(geo as unknown as GeoJsonFeature);
  }
  return { type: "FeatureCollection", features };
}

// WKT (one geometry per line) -> FeatureCollection, via wellknown.
function wktToFc(text: string): FeatureCollection {
  const features: GeoJsonFeature[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const geom = parseWkt(t) as GeoJsonGeometry | null;
    if (geom) features.push({ type: "Feature", geometry: geom, properties: {} });
  }
  return { type: "FeatureCollection", features };
}

function normalizeGeoJson(v: unknown): FeatureCollection {
  const o = v as { type?: string; features?: GeoJsonFeature[] };
  if (o && o.type === "FeatureCollection" && Array.isArray(o.features)) return o as FeatureCollection;
  if (o && o.type === "Feature") return { type: "FeatureCollection", features: [o as GeoJsonFeature] };
  if (o && typeof o.type === "string") {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: o as unknown as GeoJsonGeometry, properties: {} }],
    };
  }
  return { type: "FeatureCollection", features: [] };
}

// Bounding box [minLon, minLat, maxLon, maxLat] over every coordinate, or null if empty.
function boundsOf(fc: FeatureCollection): [number, number, number, number] | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const visitCoords = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const x = c[0] as number,
        y = c[1] as number;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    for (const child of c) visitCoords(child);
  };
  const visitGeom = (g: GeoJsonGeometry | null | undefined): void => {
    if (!g) return;
    if (g.geometries) for (const sub of g.geometries) visitGeom(sub);
    else visitCoords(g.coordinates);
  };
  for (const f of fc.features) visitGeom(f.geometry);
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

class GeoEditor {
  private source = "";
  private kind: GeoKind = "geojson";
  /** True when this document supports in-place map editing (GeoJSON FeatureCollection,
   *  or KML/GPX whose source model parsed). */
  private editable = false;
  private features: GeoJsonFeature[] = [];
  /** Positional XML source model for KML/GPX; null for GeoJSON. */
  private xmlModel: XmlModel | null = null;
  private onChange: (() => void) | null = null;

  private wrap: HTMLElement | null = null;
  private map: any = null;
  private featureLayer: any = null;
  private annotationLayer: any = null;
  private panel: HTMLElement | null = null;
  private canvasWrap: HTMLElement | null = null;
  private activeTool: string | null = null;
  /** In-progress "edit shape" session, or null. */
  private editing: { gjIdx: number; srcIdx: number; ann: any } | null = null;
  /** Last panel anchor position, so add/delete-property can re-open in place. */
  private lastAt: { x: number; y: number } | undefined;
  /** Name labels: a dedicated canvas layer + text feature (text needs the canvas renderer). */
  private labelsOn = false;
  private labelLayer: any = null;
  private labelFeature: any = null;
  /** For a .kmz: the unzipped archive entries + the inner KML entry name, for re-zipping. */
  private kmz: { entries: Record<string, Uint8Array>; kmlName: string } | null = null;
  /** The document's file name, used to name exported files. */
  private filename = "";

  constructor(private opts: GeoEditorOptions) {}

  mount(container: HTMLElement, input: GeoInput): void {
    ensureStyles();
    this.onChange = this.opts.onChange ?? null;
    this.filename = this.opts.filename ?? input.filename ?? "";
    // A .kmz is a zip wrapping a KML document: unzip it, edit the inner KML, re-zip on save.
    this.kmz = null;
    if (input.bytes && input.bytes.length) {
      const inner = this.openKmz(input.bytes);
      if (inner) {
        this.source = inner;
        this.kind = "kml";
      }
    }
    if (!this.kmz) {
      this.source = input.text ?? "";
      this.kind = detectKind(this.source, this.filename);
    }

    const wrap = document.createElement("div");
    wrap.className = "ge";
    container.appendChild(wrap);
    this.wrap = wrap;

    let fc: FeatureCollection;
    try {
      fc = toFeatureCollection(this.source, this.kind);
    } catch (e) {
      this.showMessage(wrap, "This file could not be read as a map:\n" + errMsg(e));
      return;
    }
    // Editing is byte-lossless for a GeoJSON FeatureCollection (source path features[i])
    // and for KML/GPX via the positional XML source model. TopoJSON/WKT are view-only
    // (export them to an editable format). opts.editable can override.
    this.editable =
      this.opts.editable ??
      (this.kind === "geojson"
        ? this.isFeatureCollectionSource(this.source)
        : this.kind === "kml" || this.kind === "gpx");

    wrap.appendChild(this.buildToolbar());

    const canvasWrap = document.createElement("div");
    canvasWrap.className = "ge-canvas";
    wrap.appendChild(canvasWrap);
    this.canvasWrap = canvasWrap;

    const node = document.createElement("div");
    node.className = "geojs-map";
    canvasWrap.appendChild(node);
    this.panel = this.ensurePanel(canvasWrap);

    try {
      const map = geo.map({ node, center: { x: 0, y: 0 }, zoom: 1 });
      this.map = map;
      // The OSM basemap is always on (tile requests carry only z/x/y, never file data).
      map.createLayer("osm", { zIndex: 0 });
      this.featureLayer = map.createLayer("feature", {
        features: ["point", "line", "polygon"],
        zIndex: 1,
      });
      if (this.editable) this.setupDrawing(map);

      this.renderFeatures(fc);
      this.fitBounds(boundsOf(fc));
      if (!fc.features.length) this.showMessage(canvasWrap, "No map features found in this file.");
    } catch (e) {
      this.showMessage(canvasWrap, "The map could not be displayed:\n" + errMsg(e));
    }
  }

  // (Re)draw all features from a FeatureCollection: clear the layer and read fresh, so
  // an add/delete edit shows immediately. Tags each feature with its source array index.
  private renderFeatures(fc: FeatureCollection): void {
    fc.features.forEach((f, i) => (f.__idx = i));
    // For KML/GPX, re-parse the positional source model and match each rendered feature
    // to its source element by coordinate+name key (togeojson reorders GPX by type, so
    // index correlation is unsafe; a key match is order-independent and self-guarding).
    if (this.kind === "kml" || this.kind === "gpx") {
      this.xmlModel = parseXmlGeo(this.source, this.kind);
      const byKey = new Map<string, number>();
      const dup = new Set<string>();
      this.xmlModel.features.forEach((xf, i) => {
        const k = featureKey(xf.firstCoord ?? null, xf.nameText);
        if (byKey.has(k)) dup.add(k);
        byKey.set(k, i);
      });
      for (const f of fc.features) {
        const k = featureKey(firstCoordOfGeometry(f.geometry), asString(f.properties?.name));
        f.__srcIdx = !dup.has(k) && byKey.has(k) ? byKey.get(k)! : -1;
      }
    }
    this.features = fc.features;
    const layer = this.featureLayer;
    if (!layer) return;
    try {
      layer.clear?.();
    } catch {
      /* older layer without clear(); the reader replaces features anyway */
    }
    const reader = geo.createFileReader("geojsonReader", { layer });
    reader.read(fc, (features: any[]) => {
      this.applyStyles(features);
      this.wireFeatureClicks(features);
      this.applyLabels(); // refresh labels (names/positions may have changed)
      this.map?.draw();
    });
  }

  // Apply per-feature styling from simplestyle-spec properties (marker-color, stroke,
  // stroke-width, stroke-opacity, fill, fill-opacity). togeojson maps KML <Style> to the
  // same keys, so KML and GeoJSON style uniformly. Absent keys fall back to a default.
  private applyStyles(features: any[]): void {
    const num = (v: unknown, d: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };
    const col = (v: unknown, d: string) => (typeof v === "string" && v ? v : d);
    for (const f of features) {
      try {
        const isPoly = f.featureType === "polygon";
        const p = (d: any) => (d && d.properties) || {};
        f.style("strokeColor", (d: any) => col(p(d).stroke, "#1f78b4"));
        f.style("strokeWidth", (d: any) => num(p(d)["stroke-width"], 2));
        f.style("strokeOpacity", (d: any) => num(p(d)["stroke-opacity"], 1));
        f.style("fillColor", (d: any) => col(p(d).fill ?? p(d)["marker-color"], "#1f78b4"));
        f.style("fillOpacity", (d: any) => num(p(d)["fill-opacity"], isPoly ? 0.25 : 1));
      } catch {
        /* feature type without these style keys; skip */
      }
    }
  }

  // Re-parse the current source to a FeatureCollection (GeoJSON edits change the source).
  private currentFc(): FeatureCollection {
    return toFeatureCollection(this.source, this.kind);
  }

  private fitBounds(bbox: [number, number, number, number] | null): void {
    if (!bbox || !this.map) return;
    // Pad a degenerate (zero-area) box so a single point or coincident features don't
    // make GeoJS fit to an extreme zoom.
    const pad = 0.01;
    const dx = bbox[2] - bbox[0] < 1e-9 ? pad : 0;
    const dy = bbox[3] - bbox[1] < 1e-9 ? pad : 0;
    try {
      this.map.bounds(
        { left: bbox[0] - dx, bottom: bbox[1] - dy, right: bbox[2] + dx, top: bbox[3] + dy },
        "EPSG:4326",
      );
    } catch {
      /* keep the default world view */
    }
  }

  private isFeatureCollectionSource(text: string): boolean {
    try {
      const o = JSON.parse(text) as { type?: string; features?: unknown };
      return o?.type === "FeatureCollection" && Array.isArray(o.features);
    } catch {
      return false;
    }
  }

  // The editor's own sub-toolbar (like richdoc/pdf/sheet), rendered inside the editor
  // container: the drawing tools. The OSM basemap is always on, so there is no toggle.
  private buildToolbar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "ge-toolbar";

    if (this.editable) {
      const tools: [string, string, "point" | "line" | "polygon"][] = [
        ["Add point", ICON.point, "point"],
        ["Add line", ICON.line, "line"],
        ["Add area", ICON.area, "polygon"],
      ];
      // GPX has no polygon geometry, so no Area tool.
      const available = this.kind === "gpx" ? tools.filter(([, , m]) => m !== "polygon") : tools;
      for (const [title, icon, mode] of available) {
        const b = iconButton(title, icon);
        b.dataset.mode = mode;
        b.addEventListener("click", () => this.startDrawing(mode));
        bar.appendChild(b);
      }
    }

    const labels = iconButton("Toggle labels", ICON.label);
    labels.addEventListener("click", () => {
      this.labelsOn = !this.labelsOn;
      labels.classList.toggle("is-active", this.labelsOn);
      this.applyLabels();
      this.map?.draw();
    });
    bar.appendChild(labels);

    const list = iconButton("Feature list", ICON.list);
    list.addEventListener("click", () => this.openFeatureList());
    bar.appendChild(list);

    const exp = iconButton("Export as…", ICON.export);
    exp.addEventListener("click", () => this.openExportPanel());
    bar.appendChild(exp);
    return bar;
  }

  // Export the current features as GeoJSON / KML / GPX (a downloadable/shareable copy,
  // not an in-place save). Reuses the geometry serializers.
  private openExportPanel(): void {
    this.openSidePanel("Export as", (container) => {
      container.classList.add("ge-export");
      for (const fmt of ["geojson", "kml", "gpx"] as const) {
        const b = document.createElement("button");
        b.className = "ge-btn";
        b.textContent = fmt.toUpperCase();
        b.addEventListener("click", () => this.exportAs(fmt));
        container.appendChild(b);
      }
    });
  }

  private exportAs(fmt: "geojson" | "kml" | "gpx"): void {
    try {
      const features = this.currentFc().features;
      const base = (this.filename || "map").replace(/\.[^.]+$/, "");
      let text: string, name: string;
      if (fmt === "geojson") {
        text = JSON.stringify({ type: "FeatureCollection", features }, null, 2);
        name = base + ".geojson";
      } else if (fmt === "kml") {
        text = buildKmlDocument(features);
        name = base + ".kml";
      } else {
        text = buildGpxDocument(features);
        name = base + ".gpx";
      }
      this.doExport(name, strToU8(text));
    } catch (e) {
      this.notifyError("Could not export: " + errMsg(e));
    }
  }

  private notifyError(message: string): void {
    (this.opts.onError ?? ((m: string) => console.error(m)))(message);
  }

  // Save an exported file: the host's handler if provided, else a browser download.
  private doExport(name: string, bytes: Uint8Array): void {
    if (this.opts.onExport) return this.opts.onExport(name, bytes);
    const blob = new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Draw (or clear) name labels on the map from the current features. Text features need
  // the canvas renderer, so they live on a dedicated layer above the WebGL feature layer.
  private applyLabels(): void {
    if (!this.map) return;
    try {
      if (this.labelsOn && !this.labelLayer) {
        this.labelLayer = this.map.createLayer("feature", {
          features: ["text"],
          renderer: "canvas",
          zIndex: 3,
        });
      }
      if (!this.labelLayer) return; // never turned on yet
      if (!this.labelFeature) this.labelFeature = this.labelLayer.createFeature("text");
      const items = this.labelsOn
        ? this.features
            .map((f) => {
              const c = firstCoordOfGeometry(f.geometry);
              const name = asString(f.properties?.name);
              return c && name ? { x: c[0], y: c[1], name } : null;
            })
            .filter(Boolean)
        : [];
      this.labelFeature
        .data(items)
        .position((d: any) => ({ x: d.x, y: d.y }))
        .text((d: any) => d.name)
        .style({
          color: "#111",
          fontSize: "12px",
          textAlign: "left",
          textBaseline: "bottom",
          textStrokeColor: "#fff",
          textStrokeWidth: 3,
          offset: { x: 7, y: -7 },
        })
        .draw();
    } catch {
      /* text feature unsupported by the renderer; skip labels */
    }
  }

  // Open the side panel listing every feature, with a filter and select/zoom/delete.
  private openFeatureList(): void {
    this.openSidePanel("Features", (container) => this.renderFeatureList(container));
  }

  // A self-contained slide-in side panel inside the editor (no host UI dependency).
  private openSidePanel(title: string, render: (body: HTMLElement) => void): void {
    if (!this.canvasWrap) return;
    this.closeSidePanel();
    const panel = document.createElement("div");
    panel.className = "ge-side";
    const head = document.createElement("div");
    head.className = "ge-side-head";
    const h = document.createElement("span");
    h.textContent = title;
    const close = document.createElement("button");
    close.className = "ge-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => this.closeSidePanel());
    head.append(h, close);
    const body = document.createElement("div");
    body.className = "ge-side-body";
    panel.append(head, body);
    this.canvasWrap.appendChild(panel);
    render(body);
  }

  private closeSidePanel(): void {
    this.canvasWrap?.querySelector(".ge-side")?.remove();
  }

  private renderFeatureList(container: HTMLElement): void {
    container.classList.add("ge-list");
    const filter = document.createElement("input");
    filter.className = "ge-list-filter";
    filter.placeholder = "Filter features…";
    const list = document.createElement("div");
    list.className = "ge-list-items";
    container.append(filter, list);

    const build = () => {
      const q = filter.value.trim().toLowerCase();
      list.textContent = "";
      let shown = 0;
      this.features.forEach((f, i) => {
        const name =
          asString(f.properties?.name) || `#${i + 1} ${geomLabel(f.geometry?.type ?? "")}`;
        if (q && !name.toLowerCase().includes(q)) return;
        shown++;
        const item = document.createElement("div");
        item.className = "ge-litem";
        const nameEl = document.createElement("button");
        nameEl.className = "ge-litem-name";
        nameEl.textContent = name;
        nameEl.addEventListener("click", () => this.selectFeature(i));
        item.appendChild(nameEl);
        if (this.editable && (this.kind === "geojson" ? i >= 0 : (f.__srcIdx ?? -1) >= 0)) {
          const del = document.createElement("button");
          del.className = "ge-rowdel";
          del.textContent = "×";
          del.title = "Delete feature";
          del.addEventListener("click", () => {
            this.removeFeature(i, f.__srcIdx ?? -1);
            build();
          });
          item.appendChild(del);
        }
        list.appendChild(item);
      });
      if (!shown) list.appendChild(textDiv("No features."));
    };
    filter.addEventListener("input", build);
    build();
  }

  // Zoom to a feature and open its properties.
  private selectFeature(gjIdx: number): void {
    const f = this.features[gjIdx];
    if (!f) return;
    this.zoomToFeature(gjIdx);
    const props = (f.properties ?? null) as Record<string, unknown> | null;
    this.showProps(gjIdx, f.__srcIdx ?? -1, props, this.firstCoordDisplay(f.geometry ?? undefined));
  }

  private zoomToFeature(gjIdx: number): void {
    const f = this.features[gjIdx];
    if (!f) return;
    this.fitBounds(boundsOf({ type: "FeatureCollection", features: [f] }));
  }

  // Reflect which draw tool is armed by highlighting its button.
  private syncToolButtons(): void {
    this.wrap?.querySelectorAll(".ge-tool[data-mode]").forEach((b) => {
      b.classList.toggle("is-active", (b as HTMLElement).dataset.mode === this.activeTool);
    });
  }

  private wireFeatureClicks(features: any[]): void {
    if (!Array.isArray(features) || !this.panel) return;
    for (const feature of features) {
      try {
        feature.geoOn(geo.event.feature.mouseclick, (evt: any) => {
          const datum = evt?.data;
          const gjIdx = typeof datum?.__idx === "number" ? (datum.__idx as number) : -1;
          const srcIdx = typeof datum?.__srcIdx === "number" ? (datum.__srcIdx as number) : -1;
          const props =
            (datum && (datum.properties as Record<string, unknown>)) ??
            (datum && typeof datum === "object" ? (datum as Record<string, unknown>) : null);
          const at = evt?.mouse?.map as { x: number; y: number } | undefined;
          this.showProps(gjIdx, srcIdx, props, at);
        });
      } catch {
        /* feature type without click plumbing; skip */
      }
    }
  }

  // Set up the annotation layer used for drawing new features. When an annotation is
  // completed, capture its geometry, remove the temporary annotation, and open the form.
  private setupDrawing(map: any): void {
    this.annotationLayer = map.createLayer("annotation", { zIndex: 2 });
    map.geoOn(geo.event.annotation.state, (evt: any) => {
      const ann = evt?.annotation;
      if (!ann || ann.state?.() !== geo.annotation.state.done) return;
      let geometry: GeoJsonGeometry | null = null;
      try {
        geometry = ann.geojson?.()?.geometry ?? null;
      } catch {
        geometry = null;
      }
      try {
        this.annotationLayer.removeAnnotation(ann);
      } catch {
        /* ignore */
      }
      this.annotationLayer.mode(null);
      this.activeTool = null;
      this.syncToolButtons();
      if (geometry) this.openFeatureForm(geometry);
    });
  }

  private startDrawing(mode: "point" | "line" | "polygon"): void {
    this.panel?.classList.remove("is-open");
    this.cancelShapeEdit();
    try {
      // Toggle off if the same tool is already armed.
      const next = this.activeTool === mode ? null : mode;
      this.annotationLayer?.mode(next);
      this.activeTool = next;
      this.syncToolButtons();
    } catch (e) {
      this.notifyError("Could not start drawing: " + errMsg(e));
    }
  }

  // Reshape an existing feature: load its geometry as an editable GeoJS annotation and
  // show a Done/Cancel bar. On Done, the new coordinates are spliced into the source.
  private startShapeEdit(gjIdx: number, srcIdx: number): void {
    const layer = this.annotationLayer;
    const geom = this.features[gjIdx]?.geometry;
    if (!layer || !geom) return;
    this.panel?.classList.remove("is-open");
    this.cancelShapeEdit();
    try {
      // Import the feature's geometry (GeoJSON EPSG:4326) as an annotation, then edit it.
      layer.geojson({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: geom }] }, "update");
      const anns = layer.annotations();
      const ann = anns[anns.length - 1];
      if (!ann) return;
      this.editing = { gjIdx, srcIdx, ann };
      layer.mode("edit", ann);
      this.map?.draw();
      this.showEditBar();
    } catch (e) {
      this.notifyError("Could not edit shape: " + errMsg(e));
      this.cancelShapeEdit();
    }
  }

  private showEditBar(): void {
    if (!this.canvasWrap) return;
    this.hideEditBar();
    const bar = document.createElement("div");
    bar.className = "ge-editbar";
    const label = document.createElement("span");
    label.textContent = "Drag the handles to reshape";
    const done = document.createElement("button");
    done.className = "ge-btn ge-primary";
    done.textContent = "Done";
    done.addEventListener("click", () => this.finishShapeEdit());
    const cancel = document.createElement("button");
    cancel.className = "ge-btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.cancelShapeEdit());
    bar.append(label, done, cancel);
    this.canvasWrap.appendChild(bar);
  }

  private hideEditBar(): void {
    this.canvasWrap?.querySelector(".ge-editbar")?.remove();
  }

  private finishShapeEdit(): void {
    const session = this.editing;
    if (!session) return;
    let geometry: GeoJsonGeometry | null = null;
    try {
      geometry = session.ann.geojson?.()?.geometry ?? null;
    } catch {
      geometry = null;
    }
    this.cancelShapeEdit();
    if (!geometry) return;
    try {
      if (this.kind === "geojson") {
        this.source = setGeometryCoords(this.source, session.gjIdx, geometry.coordinates);
      } else if (this.kind === "kml" && this.xmlModel) {
        const xf = this.xmlModel.features[session.srcIdx];
        if (xf) this.source = setKmlGeometry(this.source, xf, geometry);
      } else if (this.kind === "gpx" && this.xmlModel && geometry.type === "Point") {
        const xf = this.xmlModel.features[session.srcIdx];
        const c = geometry.coordinates as number[];
        if (xf) this.source = setGpxWptCoord(this.source, xf, c[0]!, c[1]!);
      }
      this.onChange?.();
      this.renderFeatures(this.currentFc());
    } catch (e) {
      this.notifyError("Could not save shape: " + errMsg(e));
    }
  }

  private cancelShapeEdit(): void {
    this.hideEditBar();
    const session = this.editing;
    this.editing = null;
    if (!session) return;
    try {
      this.annotationLayer?.mode(null);
      this.annotationLayer?.removeAnnotation(session.ann);
      this.map?.draw();
    } catch {
      /* ignore teardown errors */
    }
  }

  private ensurePanel(wrap: HTMLElement): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "ge-props";
    const close = document.createElement("button");
    close.className = "ge-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => panel.classList.remove("is-open"));
    panel.appendChild(close);
    wrap.appendChild(panel);
    return panel;
  }

  private showProps(
    gjIdx: number,
    srcIdx: number,
    props: Record<string, unknown> | null,
    at: { x: number; y: number } | undefined,
  ): void {
    const panel = this.panel;
    if (!panel) return;
    this.lastAt = at;
    panel.querySelectorAll(".ge-body").forEach((n) => n.remove());
    const body = document.createElement("div");
    body.className = "ge-body";
    const title = document.createElement("h4");
    title.textContent = "Feature";
    body.appendChild(title);

    const isGeojson = this.kind === "geojson";
    const canEdit = this.editable && (isGeojson ? gjIdx >= 0 : srcIdx >= 0);
    const entries = props
      ? Object.entries(props).filter(([k]) => k !== "__idx" && k !== "__srcIdx")
      : [];

    if (isGeojson) {
      // GeoJSON: every scalar property is editable in place; new keys can be added and
      // existing ones removed.
      if (!entries.length && !canEdit) body.appendChild(textDiv("No properties."));
      for (const [key, value] of entries) {
        const scalar = value === null || ["string", "number", "boolean"].includes(typeof value);
        body.appendChild(
          canEdit && scalar
            ? this.editRow(
                key,
                value === null ? "" : String(value),
                (v) => this.commitProp(gjIdx, key, value, v),
                () => this.deleteGeoProp(gjIdx, key),
              )
            : readonlyRow(key, value),
        );
      }
      if (canEdit) {
        const geom = this.features[gjIdx]?.geometry;
        if (geom) body.appendChild(this.colorRow(gjIdx, geom, props));
        body.appendChild(this.addPropertyRow(gjIdx));
      }
    } else if (canEdit) {
      // KML/GPX: name + description edit through the XML source model; other
      // togeojson-derived properties are shown read-only.
      const descKey = this.kind === "gpx" ? "desc" : "description";
      const xf = this.xmlModel?.features[srcIdx];
      body.appendChild(this.editRow("name", xf?.nameText ?? "", (v) => this.commitXmlField(srcIdx, "name", v)));
      body.appendChild(this.editRow("description", xf?.descText ?? "", (v) => this.commitXmlField(srcIdx, "desc", v)));
      for (const [key, value] of entries) {
        if (key === "name" || key === descKey) continue;
        body.appendChild(readonlyRow(key, value));
      }
    } else {
      if (!entries.length) body.appendChild(textDiv("No properties."));
      for (const [key, value] of entries) body.appendChild(readonlyRow(key, value));
    }

    if (!canEdit && entries.length) {
      body.appendChild(
        hintDiv(
          isGeojson
            ? "Read-only (not a FeatureCollection)."
            : "This feature could not be matched to the source; read-only.",
        ),
      );
    }

    if (canEdit) {
      const geom = this.features[gjIdx]?.geometry;
      if (geom && this.isEditableGeometry(geom)) {
        const edit = document.createElement("button");
        edit.className = "ge-btn";
        edit.textContent = "Edit shape";
        edit.addEventListener("click", () => this.startShapeEdit(gjIdx, srcIdx));
        body.appendChild(edit);
      }
      const del = document.createElement("button");
      del.className = "ge-btn ge-danger";
      del.textContent = "Delete feature";
      del.addEventListener("click", () => {
        panel.classList.remove("is-open");
        this.removeFeature(gjIdx, srcIdx);
      });
      body.appendChild(del);
    }

    panel.appendChild(body);
    panel.classList.add("is-open");
    this.positionPanel(at);
  }

  // Which geometries the map can reshape: point/line/polygon for GeoJSON & KML; only
  // points (wpt) for GPX (track/route vertex editing is deferred).
  private isEditableGeometry(geom: GeoJsonGeometry): boolean {
    const t = geom.type;
    if (this.kind === "gpx") return t === "Point";
    return t === "Point" || t === "LineString" || t === "Polygon";
  }

  // A labelled editable row wired to commit on change/Enter, with an optional × delete.
  private editRow(
    key: string,
    value: string,
    onCommit: (v: string) => void,
    onDelete?: () => void,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = onDelete ? "ge-row has-del" : "ge-row";
    const label = document.createElement("label");
    label.textContent = key;
    const input = document.createElement("input");
    input.value = value;
    input.addEventListener("change", () => onCommit(input.value));
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") input.blur();
    });
    row.append(label, input);
    if (onDelete) {
      const del = document.createElement("button");
      del.className = "ge-rowdel";
      del.textContent = "×";
      del.title = "Remove property";
      del.addEventListener("click", onDelete);
      row.appendChild(del);
    }
    return row;
  }

  // The "add property" row: key + value + a button that inserts the pair.
  private addPropertyRow(gjIdx: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "ge-addprop";
    const key = document.createElement("input");
    key.placeholder = "new property";
    const val = document.createElement("input");
    val.placeholder = "value";
    const add = document.createElement("button");
    add.className = "ge-btn";
    add.textContent = "+";
    add.title = "Add property";
    const commit = () => {
      const k = key.value.trim();
      if (!k) return;
      this.commitProp(gjIdx, k, "", val.value);
      this.reshow(gjIdx, -1);
    };
    add.addEventListener("click", commit);
    val.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") commit();
    });
    row.append(key, val, add);
    return row;
  }

  // A colour picker mapped to the right simplestyle key for the geometry (points use
  // marker-color, lines stroke, polygons fill). Writes the property on change.
  private colorRow(gjIdx: number, geom: GeoJsonGeometry, props: Record<string, unknown> | null): HTMLElement {
    const key =
      geom.type === "Point" || geom.type === "MultiPoint"
        ? "marker-color"
        : geom.type === "LineString" || geom.type === "MultiLineString"
          ? "stroke"
          : "fill";
    const row = document.createElement("div");
    row.className = "ge-row";
    const label = document.createElement("label");
    label.textContent = "color";
    const input = document.createElement("input");
    input.type = "color";
    const cur = asString(props?.[key]);
    input.value = /^#[0-9a-f]{6}$/i.test(cur ?? "") ? (cur as string) : "#1f78b4";
    input.addEventListener("change", () => this.commitProp(gjIdx, key, props?.[key] ?? "", input.value));
    row.append(label, input);
    return row;
  }

  private deleteGeoProp(gjIdx: number, key: string): void {
    try {
      this.source = deleteProperty(this.source, gjIdx, key);
      const f = this.features[gjIdx];
      if (f?.properties) delete f.properties[key];
      this.onChange?.();
      this.renderFeatures(this.currentFc());
      this.reshow(gjIdx, -1);
    } catch (e) {
      this.notifyError("Could not delete property: " + errMsg(e));
    }
  }

  // Re-open the properties panel for the same feature (after add/delete property).
  private reshow(gjIdx: number, srcIdx: number): void {
    const props = (gjIdx >= 0 ? this.features[gjIdx]?.properties : null) as Record<
      string,
      unknown
    > | null;
    this.showProps(gjIdx, srcIdx, props ?? null, this.lastAt);
  }

  // The popup form shown after drawing a new geometry: capture name/description, then
  // insert the feature into the source (byte-lossless) and re-render.
  private openFeatureForm(geometry: GeoJsonGeometry): void {
    const panel = this.panel;
    if (!panel) return;
    panel.querySelectorAll(".ge-body").forEach((n) => n.remove());
    const body = document.createElement("div");
    body.className = "ge-body";

    const title = document.createElement("h4");
    title.textContent = "New " + geomLabel(geometry.type);
    body.appendChild(title);

    const nameInput = labelledInput(body, "name");
    const descInput = labelledInput(body, "description");

    const actions = document.createElement("div");
    actions.className = "ge-actions";
    const add = document.createElement("button");
    add.className = "ge-btn ge-primary";
    add.textContent = "Add";
    const cancel = document.createElement("button");
    cancel.className = "ge-btn";
    cancel.textContent = "Cancel";
    add.addEventListener("click", () => {
      const properties: Record<string, unknown> = {};
      if (nameInput.value.trim()) properties.name = nameInput.value.trim();
      if (descInput.value.trim()) properties.description = descInput.value.trim();
      panel.classList.remove("is-open");
      this.addFeature(geometry, properties);
    });
    cancel.addEventListener("click", () => panel.classList.remove("is-open"));
    actions.append(add, cancel);
    body.appendChild(actions);

    panel.appendChild(body);
    panel.classList.add("is-open");
    // Anchor near the drawn geometry's first coordinate.
    this.positionPanel(this.firstCoordDisplay(geometry));
    nameInput.focus();
  }

  private addFeature(geometry: GeoJsonGeometry, properties: Record<string, unknown>): void {
    try {
      if (this.kind === "geojson") {
        const feature = { type: "Feature", properties, geometry };
        this.source = insertFeature(this.source, this.features.length, feature);
      } else if (this.xmlModel) {
        const props = properties as Record<string, string>;
        const xml =
          this.kind === "kml"
            ? buildKmlFeature(geometry, props)
            : buildGpxFeature(geometry, props);
        if (!xml) {
          this.notifyError("This geometry is not supported by " + this.kind + ".");
          return;
        }
        this.source = insertXmlFeature(this.source, this.xmlModel, xml);
      }
      this.onChange?.();
      this.renderFeatures(this.currentFc());
    } catch (e) {
      this.notifyError("Could not add feature: " + errMsg(e));
    }
  }

  private removeFeature(gjIdx: number, srcIdx: number): void {
    try {
      if (this.kind === "geojson") {
        if (gjIdx < 0) return;
        this.source = deleteFeature(this.source, gjIdx);
      } else if (this.xmlModel && srcIdx >= 0) {
        const xf = this.xmlModel.features[srcIdx];
        if (!xf) return;
        this.source = deleteXmlFeature(this.source, xf);
      } else return;
      this.onChange?.();
      this.renderFeatures(this.currentFc());
    } catch (e) {
      this.notifyError("Could not delete feature: " + errMsg(e));
    }
  }

  // Edit a KML/GPX feature's name/description in place (byte-lossless XML splice).
  private commitXmlField(srcIdx: number, which: "name" | "desc", value: string): void {
    if (!this.xmlModel) return;
    const xf: XmlFeature | undefined = this.xmlModel.features[srcIdx];
    if (!xf) return;
    const current = which === "name" ? (xf.nameText ?? "") : (xf.descText ?? "");
    if (current === value) return; // no-op
    try {
      const next = setXmlField(this.source, this.xmlModel, xf, which, value);
      if (next === this.source) return;
      this.source = next;
      this.onChange?.();
      this.renderFeatures(this.currentFc());
    } catch (e) {
      this.notifyError("Could not update property: " + errMsg(e));
    }
  }

  // Display-pixel position of a geometry's first coordinate, for anchoring the form.
  private firstCoordDisplay(g: GeoJsonGeometry | null | undefined): { x: number; y: number } | undefined {
    if (!g) return undefined;
    let c: unknown = g.coordinates;
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
      try {
        return this.map?.gcsToDisplay({ x: c[0] as number, y: c[1] as number }, "EPSG:4326");
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  // Write an edited property value back into the source JSON, preserving all other bytes.
  // Coerces to the property's original scalar type so numbers/booleans stay unquoted.
  private commitProp(idx: number, key: string, original: unknown, raw: string): void {
    const value = coerceScalar(original, raw);
    if (String(original ?? "") === String(value)) return; // no-op

    try {
      const next = applyPropertyEdit(this.source, idx, key, value);
      if (next === this.source) return;
      this.source = next;
      const f = this.features[idx];
      if (f && f.properties) f.properties[key] = value;
      this.onChange?.();
    } catch (e) {
      this.notifyError("Could not update property: " + errMsg(e));
    }
  }

  private positionPanel(at: { x: number; y: number } | undefined): void {
    const wrap = this.canvasWrap,
      panel = this.panel;
    if (!wrap || !panel) return;
    const W = wrap.clientWidth,
      H = wrap.clientHeight;
    const x = at ? at.x : W / 2;
    const y = at ? at.y : H / 2;
    const pw = panel.offsetWidth,
      ph = panel.offsetHeight;
    const gap = 12;
    const left = Math.max(pw / 2 + 6, Math.min(x, W - pw / 2 - 6));
    const above = y - gap - ph >= 0;
    const top = above ? y - gap : Math.min(y + gap, H - ph - 6);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.transform = above ? "translate(-50%, -100%)" : "translate(-50%, 0)";
  }

  private showMessage(wrap: HTMLElement, text: string): void {
    const msg = document.createElement("div");
    msg.className = "ge-msg";
    msg.textContent = text;
    wrap.appendChild(msg);
  }

  // Unzip a .kmz and return its inner KML text, remembering the archive for re-zipping.
  // Returns null if the bytes aren't a zip containing a .kml entry.
  private openKmz(bytes: Uint8Array): string | null {
    try {
      const entries = unzipSync(bytes);
      const names = Object.keys(entries).filter((n) => !n.endsWith("/"));
      const kmlName =
        names.find((n) => n.toLowerCase() === "doc.kml") ??
        names.find((n) => n.toLowerCase().endsWith(".kml"));
      if (!kmlName) return null;
      this.kmz = { entries, kmlName };
      return strFromU8(entries[kmlName]!);
    } catch {
      return null;
    }
  }

  getText(): string {
    return this.source;
  }

  // Binary output for a .kmz: re-zip with the edited KML replacing the original entry, all
  // other archive entries preserved. Undefined for plain-text geo documents.
  getBytes(): Uint8Array | undefined {
    if (!this.kmz) return undefined;
    const entries = { ...this.kmz.entries, [this.kmz.kmlName]: strToU8(this.source) };
    return zipSync(entries);
  }

  selection(): unknown {
    return null;
  }

  focus(): void {
    this.wrap?.focus?.();
  }

  dispose(): void {
    this.editing = null;
    try {
      this.map?.exit?.();
    } catch {
      /* ignore teardown errors */
    }
    this.map = null;
    this.canvasWrap = null;
    this.featureLayer = null;
    this.annotationLayer = null;
    this.panel = null;
    this.wrap?.remove();
    this.wrap = null;
  }
}

function errMsg(e: unknown): string {
  return (e as Error)?.message ?? String(e);
}

// Inline SVG icons (currentColor) for the toolbar, richdoc-style icon buttons.
const svg = (inner: string): string =>
  `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" ` +
  `stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${inner}</svg>`;
const ICON = {
  point: svg('<circle cx="9" cy="9" r="3.4" fill="currentColor" stroke="none"/>'),
  line: svg(
    '<polyline points="3,14 7,8 11,11 15,4"/>' +
      '<circle cx="3" cy="14" r="1.7" fill="currentColor" stroke="none"/>' +
      '<circle cx="15" cy="4" r="1.7" fill="currentColor" stroke="none"/>',
  ),
  area: svg('<polygon points="4,5 14,6 12.5,15 5,13"/>'),
  list: svg(
    '<line x1="6" y1="5" x2="15" y2="5"/><line x1="6" y1="9" x2="15" y2="9"/>' +
      '<line x1="6" y1="13" x2="15" y2="13"/><circle cx="3" cy="5" r="1" fill="currentColor" stroke="none"/>' +
      '<circle cx="3" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="13" r="1" fill="currentColor" stroke="none"/>',
  ),
  // A "T" (text/label) glyph.
  label: svg('<path d="M4 5h10"/><path d="M9 5v9"/>'),
  // A download/export arrow into a tray.
  export: svg('<path d="M9 3v8"/><path d="M6 8l3 3 3-3"/><path d="M4 14h10"/>'),
};

// An icon-only toolbar button with the label as its tooltip (title + aria-label).
function iconButton(title: string, icon: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "ge-tool";
  b.innerHTML = icon;
  b.title = title;
  b.setAttribute("aria-label", title);
  return b;
}

function geomLabel(type: string): string {
  if (type === "Point" || type === "MultiPoint") return "point";
  if (type === "LineString" || type === "MultiLineString") return "line";
  if (type === "Polygon" || type === "MultiPolygon") return "area";
  return "feature";
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : v == null ? undefined : String(v);
}

function textDiv(text: string): HTMLElement {
  const d = document.createElement("div");
  d.textContent = text;
  return d;
}

function hintDiv(text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "ge-hint";
  d.textContent = text;
  return d;
}

// A read-only labelled property row.
function readonlyRow(key: string, value: unknown): HTMLElement {
  const row = document.createElement("div");
  row.className = "ge-row";
  const label = document.createElement("label");
  label.textContent = key;
  const ro = document.createElement("div");
  ro.className = "ge-ro";
  ro.textContent = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
  row.append(label, ro);
  return row;
}

// A labelled text input row inside the form; returns the input element.
function labelledInput(parent: HTMLElement, name: string): HTMLInputElement {
  const row = document.createElement("div");
  row.className = "ge-row";
  const label = document.createElement("label");
  label.textContent = name;
  const input = document.createElement("input");
  input.type = "text";
  row.append(label, input);
  parent.appendChild(row);
  return input;
}

/**
 * Create a geospatial map editor inside `container` for a GeoJSON / KML / KMZ / GPX /
 * TopoJSON / WKT document. Returns a handle to read the edited document and tear down.
 */
export function createGeoEditor(
  container: HTMLElement,
  input: GeoInput,
  opts: GeoEditorOptions = {},
): GeoEditorHandle {
  const editor = new GeoEditor(opts);
  editor.mount(container, input);
  return {
    getText: () => editor.getText(),
    getBytes: () => editor.getBytes(),
    destroy: () => editor.dispose(),
  };
}
