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
}

// Parse KML/GPX into a positional model. Never throws on malformed input: it returns
// whatever features it resolved before the error.
export function parseXmlGeo(source: string, kind: GeoKindXml): XmlModel {
  const descTag = kind === "kml" ? "description" : "desc";
  const featureTags = FEATURE_TAGS[kind];
  const model: XmlModel = { features: [], container: null, descTag };

  const parser = new SaxesParser({ position: true });
  const stack: Frame[] = [];
  const featureStack: XmlFeature[] = [];
  let containerFrame: Frame | null = null;
  const containerTags =
    kind === "kml" ? new Set(["Document", "Folder", "kml"]) : new Set(["gpx"]);

  const accumulateIn = new Set(["name", descTag, "coordinates"]);

  parser.on("opentag", (t) => {
    const lc = local(t.name);
    const frame: Frame = { qname: t.name, local: lc, contentStart: parser.position };
    if (accumulateIn.has(lc)) frame.text = "";

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
