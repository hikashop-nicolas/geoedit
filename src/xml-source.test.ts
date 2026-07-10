import { describe, it, expect } from "vitest";
import {
  parseXmlGeo,
  setXmlField,
  deleteXmlFeature,
  insertXmlFeature,
  buildKmlFeature,
  buildGpxFeature,
  buildKmlDocument,
  buildGpxDocument,
  setKmlGeometry,
  setKmlColor,
  rgbToKmlColor,
  kmlColorToRgb,
  setGpxWptCoord,
} from "./xml-source";

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Eiffel</name>
      <description>Tower</description>
      <Point><coordinates>2.2945,48.8584,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Louvre</name>
      <Point><coordinates>2.3376,48.8606</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;

const GPX = `<?xml version="1.0"?>
<gpx version="1.1">
  <wpt lat="48.8584" lon="2.2945"><name>WP1</name></wpt>
  <trk><name>Track</name><trkseg><trkpt lat="48.86" lon="2.33"/><trkpt lat="48.87" lon="2.34"/></trkseg></trk>
</gpx>`;

describe("parseXmlGeo (KML)", () => {
  const model = parseXmlGeo(KML, "kml");

  it("finds every Placemark with its name/description spans and first coordinate", () => {
    expect(model.features).toHaveLength(2);
    const [a, b] = model.features;
    expect(a!.nameText).toBe("Eiffel");
    expect(a!.descText).toBe("Tower");
    expect(a!.firstCoord).toEqual([2.2945, 48.8584]);
    expect(b!.nameText).toBe("Louvre");
    expect(b!.desc).toBeUndefined();
  });

  it("name spans point exactly at the text content", () => {
    const a = model.features[0]!;
    expect(KML.slice(a.name!.start, a.name!.end)).toBe("Eiffel");
    const b = model.features[1]!;
    expect(KML.slice(b.name!.start, b.name!.end)).toBe("Louvre");
  });
});

describe("setXmlField (KML, byte-lossless)", () => {
  const model = parseXmlGeo(KML, "kml");

  it("edits an existing name, changing only that span", () => {
    const out = setXmlField(KML, model, model.features[0]!, "name", "Tour Eiffel");
    expect(out).toBe(KML.replace("<name>Eiffel</name>", "<name>Tour Eiffel</name>"));
  });

  it("escapes special characters", () => {
    const out = setXmlField(KML, model, model.features[1]!, "name", "A & B <c>");
    expect(out).toContain("<name>A &amp; B &lt;c&gt;</name>");
  });

  it("inserts a description when the feature has none", () => {
    const louvre = model.features[1]!;
    const out = setXmlField(KML, model, louvre, "desc", "Museum");
    expect(out).toContain("<description>Museum</description>");
    // The inserted child sits right after the Placemark open tag; nothing else changes.
    expect(out.replace("<description>Museum</description>", "")).toBe(KML);
  });
});

describe("deleteXmlFeature (KML)", () => {
  it("removes only the targeted Placemark, leaving the sibling and no blank line", () => {
    const model = parseXmlGeo(KML, "kml");
    const out = deleteXmlFeature(KML, model.features[1]!);
    expect(out).toContain("Eiffel");
    expect(out).not.toContain("Louvre");
    expect(out).not.toMatch(/\n\s*\n\s*<\/Document>/); // no dangling blank line
  });
});

describe("insertXmlFeature (KML)", () => {
  it("appends a new Placemark after the last one, preserving the rest", () => {
    const model = parseXmlGeo(KML, "kml");
    const xml = buildKmlFeature(
      { type: "Point", coordinates: [1, 2] },
      { name: "New", description: "" },
    );
    const out = insertXmlFeature(KML, model, xml);
    expect(out).toContain("<name>New</name>");
    expect(out).toContain("<coordinates>1,2</coordinates>");
    // The original content is still all present in order.
    expect(out.indexOf("Eiffel")).toBeLessThan(out.indexOf("Louvre"));
    expect(out.indexOf("Louvre")).toBeLessThan(out.indexOf("New"));
  });
});

describe("setKmlGeometry (byte-lossless)", () => {
  it("replaces a point's coordinates, changing only that span", () => {
    const model = parseXmlGeo(KML, "kml");
    const out = setKmlGeometry(KML, model.features[1]!, { type: "Point", coordinates: [1.5, 2.5] });
    expect(out).toBe(KML.replace("2.3376,48.8606", "1.5,2.5"));
  });

  it("records the coordinates span for the first Placemark", () => {
    const model = parseXmlGeo(KML, "kml");
    const span = model.features[0]!.coordSpans![0]!;
    expect(KML.slice(span.start, span.end)).toBe("2.2945,48.8584,0");
  });
});

describe("setKmlGeometry altitude preservation", () => {
  it("keeps a point's altitude when moving it", () => {
    const model = parseXmlGeo(KML, "kml");
    // Placemark 0 has coordinates "2.2945,48.8584,0" (with altitude).
    const out = setKmlGeometry(KML, model.features[0]!, { type: "Point", coordinates: [3, 4] });
    expect(out).toContain("<coordinates>3,4,0</coordinates>");
  });
});

describe("setXmlField CDATA safety", () => {
  const CD = `<kml><Document><Placemark><name>N</name>` +
    `<description><![CDATA[<b>hi</b>]]></description>` +
    `<Point><coordinates>1,2</coordinates></Point></Placemark></Document></kml>`;
  it("keeps CDATA wrapping when editing a CDATA description", () => {
    const model = parseXmlGeo(CD, "kml");
    const out = setXmlField(CD, model, model.features[0]!, "desc", "<i>bye</i>");
    expect(out).toContain("<![CDATA[<i>bye</i>]]>");
    expect(out).not.toContain("&lt;i&gt;");
  });
});

describe("KML colour editing", () => {
  it("converts CSS <-> KML colour (aabbggrr)", () => {
    expect(rgbToKmlColor("#ff0000")).toBe("ff0000ff");
    expect(rgbToKmlColor("#11aa22")).toBe("ff22aa11");
    expect(kmlColorToRgb("ff0000ff")).toBe("#ff0000");
  });

  it("replaces an existing inline PolyStyle colour, byte-lossless", () => {
    const src =
      `<kml><Document><Placemark><name>Z</name>` +
      `<Style><PolyStyle><color>ff112233</color></PolyStyle></Style>` +
      `<Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates>` +
      `</LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
    const model = parseXmlGeo(src, "kml");
    const out = setKmlColor(src, model.features[0]!, "Polygon", "#ff0000");
    expect(out).toBe(src.replace("ff112233", "ff0000ff"));
  });

  it("adds an inline Style when the feature has none", () => {
    const src =
      `<kml><Document><Placemark><name>P</name>` +
      `<Point><coordinates>2,48</coordinates></Point></Placemark></Document></kml>`;
    const model = parseXmlGeo(src, "kml");
    const out = setKmlColor(src, model.features[0]!, "Point", "#00ff00");
    expect(out).toContain("<Style><IconStyle><color>ff00ff00</color></IconStyle></Style>");
    expect(out).toContain("<name>P</name>");
  });
});

describe("setGpxWptCoord (byte-lossless)", () => {
  it("moves a wpt by rewriting its lat/lon attributes", () => {
    const model = parseXmlGeo(GPX, "gpx");
    const out = setGpxWptCoord(GPX, model.features[0]!, 3.5, 4.5);
    expect(out).toContain('<wpt lat="4.5" lon="3.5">');
    expect(out).toContain("<name>WP1</name>");
    expect(out).not.toContain('lat="48.8584"');
  });
});

describe("parseXmlGeo (GPX)", () => {
  const model = parseXmlGeo(GPX, "gpx");

  it("finds wpt and trk with names and first coordinates", () => {
    expect(model.features.map((f) => f.kind)).toEqual(["wpt", "trk"]);
    expect(model.features[0]!.firstCoord).toEqual([2.2945, 48.8584]);
    expect(model.features[0]!.nameText).toBe("WP1");
    expect(model.features[1]!.firstCoord).toEqual([2.33, 48.86]);
    expect(model.features[1]!.nameText).toBe("Track");
  });

  it("edits a wpt name byte-losslessly", () => {
    const out = setXmlField(GPX, model, model.features[0]!, "name", "Start");
    expect(out).toBe(GPX.replace("<name>WP1</name>", "<name>Start</name>"));
  });
});

describe("export document builders", () => {
  const features = [
    { geometry: { type: "Point", coordinates: [2, 48] }, properties: { name: "A", description: "x" } },
    { geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] }, properties: { name: "L" } },
    { geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { name: "Z" } },
  ];

  it("KML document includes every feature as a Placemark", () => {
    const kml = buildKmlDocument(features);
    expect(kml).toContain("<kml");
    expect(kml).toContain("<name>A</name>");
    expect(kml).toContain("<description>x</description>");
    expect(kml).toContain("<LineString>");
    expect(kml).toContain("<Polygon>");
    expect((kml.match(/<Placemark>/g) || []).length).toBe(3);
  });

  it("GPX document maps points/lines and skips polygons", () => {
    const gpx = buildGpxDocument(features);
    expect(gpx).toContain("<gpx");
    expect(gpx).toContain('<wpt lat="48" lon="2">');
    expect(gpx).toContain("<trk>");
    expect(gpx).not.toContain("Polygon");
    // The polygon produced no element.
    expect((gpx.match(/<wpt|<trk>/g) || []).length).toBe(2);
  });
});

describe("buildGpxFeature", () => {
  it("serializes a point to a wpt and a line to a trk", () => {
    expect(buildGpxFeature({ type: "Point", coordinates: [2, 48] }, { name: "P" })).toBe(
      '<wpt lat="48" lon="2"><name>P</name></wpt>',
    );
    const line = buildGpxFeature({ type: "LineString", coordinates: [[1, 2], [3, 4]] }, {});
    expect(line).toBe('<trk><trkseg><trkpt lat="2" lon="1"/><trkpt lat="4" lon="3"/></trkseg></trk>');
  });
});
