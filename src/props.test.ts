import { describe, it, expect } from "vitest";
import {
  applyPropertyEdit,
  coerceScalar,
  insertFeature,
  deleteFeature,
  deleteProperty,
  setGeometryCoords,
} from "./props";

const SRC = `{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "Paris", "pop": 2100000, "capital": true },
      "geometry": { "type": "Point", "coordinates": [2.3522, 48.8566] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Zone" },
      "geometry": { "type": "Polygon", "coordinates": [[[2.32,48.85],[2.38,48.85],[2.32,48.85]]] }
    }
  ]
}`;

describe("coerceScalar", () => {
  it("keeps a number a number", () => {
    expect(coerceScalar(42, "99")).toBe(99);
  });
  it("falls back to string for non-numeric input on a number field", () => {
    expect(coerceScalar(42, "n/a")).toBe("n/a");
  });
  it("parses booleans", () => {
    expect(coerceScalar(false, "true")).toBe(true);
    expect(coerceScalar(true, "no")).toBe(false);
  });
  it("leaves strings as strings", () => {
    expect(coerceScalar("Paris", "Lyon")).toBe("Lyon");
  });
});

describe("applyPropertyEdit (byte-lossless)", () => {
  it("changes only the edited string, byte-for-byte", () => {
    const out = applyPropertyEdit(SRC, 1, "name", "Downtown");
    expect(out).toBe(SRC.replace('"Zone"', '"Downtown"'));
  });

  it("keeps an edited number unquoted", () => {
    const out = applyPropertyEdit(SRC, 0, "pop", 99);
    expect(out).toBe(SRC.replace('"pop": 2100000', '"pop": 99'));
  });

  it("keeps an edited boolean unquoted", () => {
    const out = applyPropertyEdit(SRC, 0, "capital", false);
    expect(out).toBe(SRC.replace('"capital": true', '"capital": false'));
  });

  it("preserves the rest of the document (whitespace, sibling props, coordinates)", () => {
    const out = applyPropertyEdit(SRC, 0, "name", "Lutece");
    // Only the one value differs; everything else is identical.
    expect(out.replace('"Lutece"', '"Paris"')).toBe(SRC);
  });
});

describe("insertFeature / deleteFeature (byte-lossless)", () => {
  const feat = {
    type: "Feature",
    properties: { name: "New" },
    geometry: { type: "Point", coordinates: [1, 2] },
  };

  it("insert then delete round-trips back to the original bytes", () => {
    const added = insertFeature(SRC, 2, feat);
    expect(added).toContain('"name":"New"');
    // Removing the feature we just appended restores the source exactly (splice, not reformat).
    expect(deleteFeature(added, 2)).toBe(SRC);
  });

  it("delete removes only the targeted feature, leaving the other intact and bytes stable", () => {
    const out = deleteFeature(SRC, 1);
    expect(out).toContain('"Paris"');
    expect(out).not.toContain('"Zone"');
    // The first feature's block is preserved byte-for-byte.
    expect(out).toContain('"properties": { "name": "Paris", "pop": 2100000, "capital": true }');
  });
});

describe("setGeometryCoords (byte-lossless)", () => {
  it("replaces only the coordinates value, preserving all other bytes", () => {
    const out = setGeometryCoords(SRC, 0, [1, 2]);
    expect(out).toBe(SRC.replace("[2.3522, 48.8566]", "[1,2]"));
  });
});

describe("property add / delete", () => {
  it("adds a new property key", () => {
    const out = applyPropertyEdit(SRC, 1, "kind", "district");
    expect(out).toContain('"kind": "district"');
    expect(out).toContain('"Zone"');
  });

  it("deletes a property key, leaving siblings", () => {
    const out = deleteProperty(SRC, 0, "capital");
    expect(out).not.toContain('"capital"');
    expect(out).toContain('"pop": 2100000');
    expect(out).toContain('"Paris"');
  });
});
