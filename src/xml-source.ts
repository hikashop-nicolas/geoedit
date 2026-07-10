import { SaxesParser } from "saxes";

// Byte-lossless in-place editing for KML/GPX. We parse the source once with a
// position-aware SAX parser and record, for every feature-bearing element (KML
// Placemark; GPX wpt/rte/trk), the exact source offsets of its editable fields
// (name/description) plus a first-coordinate signature used to match the element to a
// rendered feature. Edits become text splices into the original string, so every byte
// the user did not touch is preserved. This mirrors how docxedit/sheetedit edit files.

export type GeoKindXml = "kml" | "gpx";

/** A content span [start, end) between an element's open and close tags. */
export interface Span {
  start: number;
  end: number;
}

export interface XmlFeature {
  /** Local element name: "Placemark" | "wpt" | "rte" | "trk". */
  kind: string;
  /** Full element span including tags, for deletion. */
  elementStart: number;
  elementEnd: number;
  /** Offset just after the open tag, where a missing child field is inserted. */
  contentStart: number;
  name?: Span;
  desc?: Span;
  nameText?: string;
  descText?: string;
  /** [lon, lat] of the element's first coordinate, for matching to a rendered feature. */
  firstCoord?: [number, number];
  /** Content spans of the feature's <coordinates> elements (KML), in document order. */
  coordSpans?: Span[];
  /** Content spans of an inline <color> under Icon/Line/PolyStyle (KML), for style editing. */
  iconColor?: Span;
  lineColor?: Span;
  polyColor?: Span;
  /** Offset just after the feature's inline <Style> open tag, for inserting a style child. */
  styleContentStart?: number;
  /** GPX: span covering the contiguous run of trkpt/rtept elements (single-segment only). */
  pointRun?: Span;
  /** GPX point element name for regeneration ("trkpt" | "rtept"). */
  pointKind?: string;
}

export interface XmlModel {
  features: XmlFeature[];
  /** The element features live in, for inserting into an otherwise-empty container. */
  container: { contentEnd: number; indent: string } | null;
  /** The description element name for this format. */
  descTag: "description" | "desc";
}

const local = (qname: string): string => {
  const i = qname.indexOf(":");
  return i === -1 ? qname : qname.slice(i + 1);
};

const FEATURE_TAGS: Record<GeoKindXml, Set<string>> = {
  kml: new Set(["Placemark"]),
  gpx: new Set(["wpt", "rte", "trk"]),
};
// Elements that can carry a first coordinate we can read cheaply.
const COORD_ATTR_TAGS = new Set(["wpt", "rtept", "trkpt"]);

interface Frame {
  qname: string;
  local: string;
  contentStart: number;
  feature?: XmlFeature; // set when this frame is itself a feature element
  text?: string; // accumulated text, only for fields/coordinates
  isFeatureStyle?: boolean; // a <Style> that is a direct child of a feature
  styleKind?: "icon" | "line" | "poly"; // an Icon/Line/PolyStyle under a feature style
}

const STYLE_KIND: Record<string, "icon" | "line" | "poly"> = {
  IconStyle: "icon",
  LineStyle: "line",
  PolyStyle: "poly",
};
const COLOR_FIELD = { icon: "iconColor", line: "lineColor", poly: "polyColor" } as const;

// Parse KML/GPX into a positional model. Never throws on malformed input: it returns
// whatever features it resolved before the error.
export function parseXmlGeo(source: string, kind: GeoKindXml): XmlModel {
  const descTag = kind === "kml" ? "description" : "desc";
  const featureTags = FEATURE_TAGS[kind];
  const model: XmlModel = { features: [], container: null, descTag };

  const parser = new SaxesParser({ position: true });
  const stack: Frame[] = [];
  const featureStack: XmlFeature[] = [];
  const segCounts = new Map<XmlFeature, number>(); // trkseg count per feature (GPX)
  let containerFrame: Frame | null = null;
  const containerTags =
    kind === "kml" ? new Set(["Document", "Folder", "kml"]) : new Set(["gpx"]);

  const accumulateIn = new Set(["name", descTag, "coordinates"]);

  parser.on("opentag", (t) => {
    const lc = local(t.name);
    const parent = stack[stack.length - 1];
    const frame: Frame = { qname: t.name, local: lc, contentStart: parser.position };
    if (accumulateIn.has(lc)) frame.text = "";

    // KML inline styles: a <Style> directly under a feature, and its Icon/Line/PolyStyle.
    if (lc === "Style" && parent?.feature) {
      frame.isFeatureStyle = true;
      parent.feature.styleContentStart = parser.position;
    } else if (STYLE_KIND[lc] && parent?.isFeatureStyle) {
      frame.styleKind = STYLE_KIND[lc];
    }

    if (featureTags.has(lc)) {
      const feature: XmlFeature = {
        kind: lc,
        elementStart: source.lastIndexOf("<", parser.position - 1),
        elementEnd: -1,
        contentStart: parser.position,
      };
      frame.feature = feature;
      featureStack.push(feature);
    }
    // First container of interest (for inserting into an empty collection).
    if (!containerFrame && containerTags.has(lc)) containerFrame = frame;

    // GPX first coordinate from lat/lon attributes.
    if (COORD_ATTR_TAGS.has(lc)) {
      const cur = featureStack[featureStack.length - 1];
      const attrs = t.attributes as Record<string, string>;
      if (cur && !cur.firstCoord && attrs.lon != null && attrs.lat != null) {
        const lon = Number(attrs.lon),
          lat = Number(attrs.lat);
        if (Number.isFinite(lon) && Number.isFinite(lat)) cur.firstCoord = [lon, lat];
      }
    }
    // GPX: count track segments and open the trkpt/rtept run span for the current feature.
    const curFeat = featureStack[featureStack.length - 1];
    if (curFeat) {
      if (lc === "trkseg") segCounts.set(curFeat, (segCounts.get(curFeat) ?? 0) + 1);
      if (lc === "trkpt" || lc === "rtept") {
        if (!curFeat.pointRun) {
          curFeat.pointRun = { start: source.lastIndexOf("<", parser.position - 1), end: -1 };
          curFeat.pointKind = lc;
        }
      }
    }
    stack.push(frame);
  });

  const addText = (s: string) => {
    const top = stack[stack.length - 1];
    if (top && top.text !== undefined) top.text += s;
  };
  parser.on("text", addText);
  parser.on("cdata", addText);

  parser.on("closetag", () => {
    const frame = stack.pop();
    if (!frame) return;
    const contentEnd = parser.position - (frame.qname.length + 3); // "</qname>"
    const parent = stack[stack.length - 1];

    if (frame.feature) {
      frame.feature.elementEnd = parser.position;
      model.features.push(frame.feature);
      featureStack.pop();
    } else if (parent?.feature) {
      // Direct child field of a feature.
      if (frame.local === "name" && !parent.feature.name) {
        parent.feature.name = { start: frame.contentStart, end: contentEnd };
        parent.feature.nameText = frame.text ?? "";
      } else if (frame.local === descTag && !parent.feature.desc) {
        parent.feature.desc = { start: frame.contentStart, end: contentEnd };
        parent.feature.descText = frame.text ?? "";
      }
    }

    // GPX: extend the point-run span to the end of the last trkpt/rtept.
    if (frame.local === "trkpt" || frame.local === "rtept") {
      const cur = featureStack[featureStack.length - 1];
      if (cur?.pointRun) cur.pointRun.end = parser.position;
    }

    // KML inline style <color> (aabbggrr) under Icon/Line/PolyStyle: record its span.
    if (frame.local === "color" && parent?.styleKind) {
      const cur = featureStack[featureStack.length - 1];
      if (cur) cur[COLOR_FIELD[parent.styleKind]] = { start: frame.contentStart, end: contentEnd };
    }

    // KML <coordinates>: capture the content span (for geometry editing) and the
    // element's first coordinate (for feature matching).
    if (frame.local === "coordinates") {
      const cur = featureStack[featureStack.length - 1];
      if (cur) {
        (cur.coordSpans ??= []).push({ start: frame.contentStart, end: contentEnd });
        if (!cur.firstCoord && frame.text) {
          const first = frame.text.trim().split(/\s+/)[0];
          const [lon, lat] = (first ?? "").split(",").map(Number);
          if (Number.isFinite(lon) && Number.isFinite(lat)) cur.firstCoord = [lon, lat];
        }
      }
    }

    if (containerFrame === frame) {
      model.container = { contentEnd, indent: lineIndent(source, frame.contentStart) };
    }
  });

  try {
    parser.write(source).close();
  } catch {
    /* return whatever resolved before the error */
  }
  // Multi-segment tracks render as MultiLineString; drop the run so geometry-edit is a no-op.
  for (const [feat, n] of segCounts) if (n > 1) feat.pointRun = undefined;
  return model;
}

// The whitespace run at the start of the line containing `pos` (the indentation).
function lineIndent(source: string, pos: number): string {
  const nl = source.lastIndexOf("\n", pos - 1);
  const lineStart = nl + 1;
  let i = lineStart;
  while (i < source.length && (source[i] === " " || source[i] === "\t")) i++;
  return source.slice(lineStart, i);
}

const escText = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string): string => escText(s).replace(/"/g, "&quot;");
// Wrap a value in CDATA, splitting any literal "]]>" so it stays valid.
const cdata = (s: string): string => "<![CDATA[" + s.replace(/]]>/g, "]]]]><![CDATA[>") + "]]>";

// Set a feature's name/description, byte-lossless: replace the existing content span,
// or insert a fresh child element right after the feature's open tag when absent.
export function setXmlField(
  source: string,
  model: XmlModel,
  feature: XmlFeature,
  which: "name" | "desc",
  value: string,
): string {
  const span = which === "name" ? feature.name : feature.desc;
  if (span) {
    // Preserve a CDATA wrapper (common in KML descriptions) instead of clobbering it.
    const existing = source.slice(span.start, span.end);
    const replacement = /^\s*<!\[CDATA\[/.test(existing) ? cdata(value) : escText(value);
    return source.slice(0, span.start) + replacement + source.slice(span.end);
  }
  const escaped = escText(value);
  const tag = which === "name" ? "name" : model.descTag;
  const child = `<${tag}>${escaped}</${tag}>`;
  return source.slice(0, feature.contentStart) + child + source.slice(feature.contentStart);
}

type Geometry = { type: string; coordinates?: unknown; geometries?: Geometry[] };

// The outer point list of a geometry (Point/LineString/Polygon outer ring), or null.
function points(geometry: Geometry): number[][] | null {
  if (geometry.type === "Point") return [geometry.coordinates as number[]];
  if (geometry.type === "LineString") return geometry.coordinates as number[][];
  if (geometry.type === "Polygon") return (geometry.coordinates as number[][][])[0] ?? [];
  return null;
}

// Serialize points to a KML coordinate string, reusing per-point altitude from the
// original text when the vertex counts line up (so a move doesn't drop elevation).
function coordString(pts: number[][], originalText: string): string {
  const alts = originalText
    .trim()
    .split(/\s+/)
    .map((tok) => tok.split(",")[2]);
  return pts
    .map((c, i) => {
      const a = pts.length === alts.length ? alts[i] : undefined;
      return a !== undefined && a !== "" ? `${c[0]},${c[1]},${a}` : `${c[0]},${c[1]}`;
    })
    .join(" ");
}

// Replace a KML feature's geometry by rewriting its first <coordinates> content span
// (Point / LineString / Polygon outer ring). Byte-lossless everywhere else, including
// any inner rings / sibling geometries. Returns the source unchanged if not applicable.
export function setKmlGeometry(source: string, feature: XmlFeature, geometry: Geometry): string {
  const span = feature.coordSpans?.[0];
  const pts = points(geometry);
  if (!span || !pts) return source;
  const text = coordString(pts, source.slice(span.start, span.end));
  return source.slice(0, span.start) + text + source.slice(span.end);
}

// Convert an "#rrggbb" CSS colour to KML "aabbggrr" (opaque alpha).
export function rgbToKmlColor(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return "ffffffff";
  return ("ff" + m[3] + m[2] + m[1]).toLowerCase();
}

// Convert a KML "aabbggrr" colour to "#rrggbb" (alpha dropped).
export function kmlColorToRgb(kml: string): string | null {
  const m = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(kml.trim());
  return m ? ("#" + m[4] + m[3] + m[2]).toLowerCase() : null;
}

const KIND_OF: Record<string, "icon" | "line" | "poly"> = {
  Point: "icon",
  MultiPoint: "icon",
  LineString: "line",
  MultiLineString: "line",
  Polygon: "poly",
  MultiPolygon: "poly",
};
const STYLE_SUB = { icon: "IconStyle", line: "LineStyle", poly: "PolyStyle" } as const;

// Set a KML feature's colour by editing its inline style <color> for the geometry's style
// kind. Replaces the existing <color> span, inserts a style sub-element into an existing
// inline <Style>, or adds a fresh inline <Style> to the Placemark. Byte-lossless elsewhere.
export function setKmlColor(
  source: string,
  feature: XmlFeature,
  geometryType: string,
  rgbHex: string,
): string {
  const kind = KIND_OF[geometryType] ?? "icon";
  const kml = rgbToKmlColor(rgbHex);
  const span = feature[COLOR_FIELD[kind]];
  if (span) return source.slice(0, span.start) + kml + source.slice(span.end);
  const sub = STYLE_SUB[kind];
  if (feature.styleContentStart != null) {
    const child = `<${sub}><color>${kml}</color></${sub}>`;
    const at = feature.styleContentStart;
    return source.slice(0, at) + child + source.slice(at);
  }
  const styleXml = `<Style><${sub}><color>${kml}</color></${sub}></Style>`;
  const at = feature.contentStart;
  return source.slice(0, at) + styleXml + source.slice(at);
}

// Move a GPX wpt by replacing the lat/lon attribute values inside its open tag. Byte-
// lossless everywhere else. Returns the source unchanged if the attributes aren't found.
export function setGpxWptCoord(
  source: string,
  feature: XmlFeature,
  lon: number,
  lat: number,
): string {
  const open = source.slice(feature.elementStart, feature.contentStart);
  let replaced = open
    .replace(/\blat\s*=\s*"[^"]*"/, `lat="${lat}"`)
    .replace(/\blon\s*=\s*"[^"]*"/, `lon="${lon}"`);
  // Also handle single-quoted attributes.
  replaced = replaced
    .replace(/\blat\s*=\s*'[^']*'/, `lat="${lat}"`)
    .replace(/\blon\s*=\s*'[^']*'/, `lon="${lon}"`);
  if (replaced === open) return source;
  return source.slice(0, feature.elementStart) + replaced + source.slice(feature.contentStart);
}

// Reshape a single-segment GPX track/route: replace its trkpt/rtept run with points
// regenerated from the geometry (lat/lon only; per-point ele/time on the edited run are
// dropped). Byte-lossless outside the run. No-op for multi-segment tracks (pointRun unset).
export function setGpxGeometry(source: string, feature: XmlFeature, geometry: Geometry): string {
  const run = feature.pointRun;
  const pts = points(geometry);
  if (!run || run.end < 0 || !feature.pointKind || !pts) return source;
  const indent = lineIndent(source, run.start);
  const tag = feature.pointKind;
  const body = pts.map((c) => `<${tag} lat="${c[1]}" lon="${c[0]}"/>`).join("\n" + indent);
  return source.slice(0, run.start) + body + source.slice(run.end);
}

// Remove a feature element and its line's leading whitespace + preceding newline, so no
// blank line is left behind. Every other byte is preserved.
export function deleteXmlFeature(source: string, feature: XmlFeature): string {
  let start = feature.elementStart;
  while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
  if (start > 0 && source[start - 1] === "\n") start--;
  return source.slice(0, start) + source.slice(feature.elementEnd);
}

// Insert a new feature element, either after the last existing feature or into the
// container when the collection is empty. Returns the source unchanged if there is
// nowhere sensible to put it.
export function insertXmlFeature(source: string, model: XmlModel, elementXml: string): string {
  if (model.features.length) {
    const last = model.features[model.features.length - 1]!;
    const indent = lineIndent(source, last.elementStart);
    const at = last.elementEnd;
    return source.slice(0, at) + "\n" + indent + elementXml + source.slice(at);
  }
  if (model.container) {
    const indent = model.container.indent + "  ";
    const at = model.container.contentEnd;
    return (
      source.slice(0, at) +
      "\n" +
      indent +
      elementXml +
      "\n" +
      model.container.indent +
      source.slice(at)
    );
  }
  return source;
}

// The first [lon, lat] found in a GeoJSON geometry (depth-first).
export function firstCoordOfGeometry(g: Geometry | null | undefined): [number, number] | null {
  if (!g) return null;
  if (g.geometries) {
    for (const sub of g.geometries) {
      const c = firstCoordOfGeometry(sub);
      if (c) return c;
    }
    return null;
  }
  let c: unknown = g.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
    return [c[0], c[1]];
  }
  return null;
}

// A matching key from a first coordinate + name; order-independent correlation between
// rendered (togeojson) features and source elements.
export function featureKey(coord: [number, number] | null, name: string | undefined): string {
  const c = coord ? `${coord[0].toFixed(5)},${coord[1].toFixed(5)}` : "?";
  return `${c}|${name ?? ""}`;
}

// Map each rendered feature (by its key) to a source-element index, or -1 when there is
// no unambiguous match (that feature stays non-editable, never mis-spliced).
export function matchByKey(
  xmlFeatures: XmlFeature[],
  keyOf: (i: number) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  const index = new Map<string, number>();
  xmlFeatures.forEach((f, i) => {
    const k = featureKey(f.firstCoord ?? null, f.nameText);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    index.set(k, i);
  });
  // Drop ambiguous keys (same coord+name appears more than once).
  for (const [k, n] of counts) if (n > 1) index.delete(k);
  void keyOf;
  return index;
}

// Build a KML <Placemark> for a drawn geometry.
export function buildKmlFeature(geometry: Geometry, props: Record<string, string>): string {
  const parts = ["<Placemark>"];
  if (props.name) parts.push(`<name>${escText(props.name)}</name>`);
  if (props.description) parts.push(`<description>${escText(props.description)}</description>`);
  parts.push(kmlGeometry(geometry));
  parts.push("</Placemark>");
  return parts.join("");
}

function kmlCoords(coords: number[][]): string {
  return coords.map((c) => `${c[0]},${c[1]}`).join(" ");
}
function kmlGeometry(g: Geometry): string {
  if (g.type === "Point") {
    const c = g.coordinates as number[];
    return `<Point><coordinates>${c[0]},${c[1]}</coordinates></Point>`;
  }
  if (g.type === "LineString") {
    return `<LineString><coordinates>${kmlCoords(g.coordinates as number[][])}</coordinates></LineString>`;
  }
  if (g.type === "Polygon") {
    const ring = (g.coordinates as number[][][])[0] ?? [];
    return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(ring)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
  }
  return "";
}

interface FeatureLike {
  geometry: Geometry | null;
  properties?: Record<string, unknown> | null;
}

// String name/description from a feature's properties (for export document builders).
function metaOf(f: FeatureLike): Record<string, string> {
  const p = f.properties ?? {};
  const s = (v: unknown) => (v == null ? "" : String(v));
  return { name: s(p.name), description: s(p.description ?? p.desc) };
}

// Serialize a FeatureCollection to a full KML document (for export/conversion).
export function buildKmlDocument(features: FeatureLike[]): string {
  const body = features
    .filter((f) => f.geometry)
    .map((f) => "  " + buildKmlFeature(f.geometry as Geometry, metaOf(f)))
    .join("\n");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n' +
    body +
    "\n</Document>\n</kml>\n"
  );
}

// Serialize a FeatureCollection to a full GPX document. Only points and lines map to GPX
// (wpt/trk); polygons and other geometries are skipped.
export function buildGpxDocument(features: FeatureLike[]): string {
  const body = features
    .map((f) => (f.geometry ? buildGpxFeature(f.geometry, metaOf(f)) : ""))
    .filter(Boolean)
    .map((x) => "  " + x)
    .join("\n");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="Omnitext" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    body +
    "\n</gpx>\n"
  );
}

// Build a GPX element for a drawn geometry (Point -> wpt, LineString -> trk).
export function buildGpxFeature(geometry: Geometry, props: Record<string, string>): string {
  const meta =
    (props.name ? `<name>${escText(props.name)}</name>` : "") +
    (props.description ? `<desc>${escText(props.description)}</desc>` : "");
  if (geometry.type === "Point") {
    const c = geometry.coordinates as number[];
    return `<wpt lat="${escAttr(String(c[1]))}" lon="${escAttr(String(c[0]))}">${meta}</wpt>`;
  }
  if (geometry.type === "LineString") {
    const pts = (geometry.coordinates as number[][])
      .map((c) => `<trkpt lat="${escAttr(String(c[1]))}" lon="${escAttr(String(c[0]))}"/>`)
      .join("");
    return `<trk>${meta}<trkseg>${pts}</trkseg></trk>`;
  }
  return "";
}
