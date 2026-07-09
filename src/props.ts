import { modify, applyEdits, parseTree, findNodeAtLocation } from "jsonc-parser";

// Pure helpers for byte-lossless GeoJSON property editing, kept free of GeoJS/DOM so
// they are unit-testable. The map editor (geoeditor.impl) wires these to the panel.

// Coerce an edited input string back to the property's original scalar type, so numbers
// and booleans stay unquoted in the JSON. Unparseable numbers fall back to the string.
export function coerceScalar(original: unknown, raw: string): unknown {
  if (typeof original === "number") {
    const n = Number(raw);
    return raw.trim() !== "" && Number.isFinite(n) ? n : raw;
  }
  if (typeof original === "boolean") return raw.trim().toLowerCase() === "true";
  return raw;
}

const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

// Apply an edit to features[idx].properties[key], rewriting only that value and leaving
// every other byte of the source untouched. Returns the source unchanged on a no-op.
export function applyPropertyEdit(
  source: string,
  idx: number,
  key: string,
  value: unknown,
): string {
  const edits = modify(source, ["features", idx, "properties", key], value, FORMAT);
  return applyEdits(source, edits);
}

// The whitespace indent of the line containing `offset`.
function lineIndent(source: string, offset: number): string {
  const nl = source.lastIndexOf("\n", offset - 1);
  let i = nl + 1;
  while (i < source.length && (source[i] === " " || source[i] === "\t")) i++;
  return source.slice(nl + 1, i);
}

// Insert a new feature at the end of the features array as a targeted text splice, so
// every existing byte is preserved (unlike jsonc-parser's array reformat). `count` is
// unused (kept for call-site compatibility).
export function insertFeature(source: string, _count: number, feature: unknown): string {
  const root = parseTree(source);
  const arr = root && findNodeAtLocation(root, ["features"]);
  if (!arr) return source;
  const items = arr.children ?? [];
  const text = JSON.stringify(feature);
  if (items.length === 0) {
    const at = arr.offset + arr.length - 1; // just before the closing ']'
    return source.slice(0, at) + text + source.slice(at);
  }
  const last = items[items.length - 1]!;
  const at = last.offset + last.length;
  return source.slice(0, at) + ",\n" + lineIndent(source, last.offset) + text + source.slice(at);
}

// Remove features[idx] as a targeted text splice (with its comma), preserving the rest.
export function deleteFeature(source: string, idx: number): string {
  const root = parseTree(source);
  const arr = root && findNodeAtLocation(root, ["features"]);
  const items = arr?.children ?? [];
  const node = items[idx];
  if (!node) return source;
  let start = node.offset;
  let end = node.offset + node.length;
  if (idx < items.length - 1) {
    end = items[idx + 1]!.offset; // swallow the following comma + whitespace
  } else if (idx > 0) {
    const prev = items[idx - 1]!;
    start = prev.offset + prev.length; // swallow the preceding comma + whitespace
  }
  return source.slice(0, start) + source.slice(end);
}

// Replace features[idx].geometry.coordinates with new coordinates as a targeted splice
// (compact array), preserving every other byte.
export function setGeometryCoords(source: string, idx: number, coords: unknown): string {
  const root = parseTree(source);
  const node = root && findNodeAtLocation(root, ["features", idx, "geometry", "coordinates"]);
  if (!node) return source;
  const text = JSON.stringify(coords);
  return source.slice(0, node.offset) + text + source.slice(node.offset + node.length);
}

// Remove a property key from features[idx].properties.
export function deleteProperty(source: string, idx: number, key: string): string {
  const edits = modify(source, ["features", idx, "properties", key], undefined, FORMAT);
  return applyEdits(source, edits);
}
