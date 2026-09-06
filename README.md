# geoedit

A standalone, framework-agnostic, client-side **map editor** for geospatial files:
**GeoJSON, KML, KMZ, GPX, TopoJSON and WKT**. It renders a file's features on an
interactive map, lets you **view and edit** them (move/reshape geometry, edit
properties, add/delete features, restyle), and writes the changes **back into your
file byte-for-byte**, all in the browser. No server, no upload.

**[▶ Live demo](https://hikashop-nicolas.github.io/geoedit/)** — drop a `.geojson`,
`.kml`, `.kmz`, `.gpx`, `.topojson` or `.wkt` file and edit it on the map.

Used in production by **[Omnitext](https://hikashop-nicolas.github.io/omnitext/)**, a free
browser editor for practically any file, as its map editor for
[GeoJSON](https://hikashop-nicolas.github.io/omnitext/formats/geojson.html),
[KML](https://hikashop-nicolas.github.io/omnitext/formats/kml.html) and
[GPX](https://hikashop-nicolas.github.io/omnitext/formats/gpx.html).

```ts
import { createGeoEditor } from "geoedit";

const handle = createGeoEditor(containerEl, { text: fileText, filename: "map.geojson" }, {
  onChange: () => console.log("edited"),
});

// later, to save:
const edited = handle.getText();        // the edited file, byte-for-byte
// for .kmz, use handle.getBytes() instead (re-zipped)
```

## What it does

- **Renders** any GeoJSON / KML / KMZ / GPX / TopoJSON / WKT / **Shapefile** on a GeoJS
  map over an OpenStreetMap basemap. Only tile requests (z/x/y) leave the browser —
  **never any file data**.
- **Edits, byte-lossless.** GeoJSON edits are applied with a JSON CST
  ([`jsonc-parser`](https://github.com/microsoft/node-jsonc-parser)); KML/GPX edits are
  spliced into the source with a position-aware SAX parser
  ([`saxes`](https://github.com/lddubeau/saxes)). Only the span you changed is
  rewritten — styling, folders, ExtendedData, comments and formatting are preserved.
- **Draw** points, lines and areas with a popup form; **reshape** existing geometry by
  dragging vertices; **delete** features; **edit any property** (and add/remove keys);
  **restyle** with a colour picker (simplestyle for GeoJSON, inline `<Style>` for KML).
- **Undo / redo** (Ctrl+Z / Ctrl+Shift+Z) of every edit.
- **Feature list** with filter and zoom-to; optional **name labels**; a **measure tool**
  (geodesic distance + area) and a live **coordinate readout**.
- **Convert / export** the current document to GeoJSON, KML or GPX.
- **Multilingual** (English, French, Japanese; auto-detected, `setLocale()` to override)
  and **keyboard-accessible** (Escape closes panels, ARIA dialog roles).
- **TopoJSON, WKT and Shapefiles** are view-only (export them to an editable format).

## Editing model

The document's **source text is the model**. The editor never round-trips through a
lossy intermediate: it holds your original bytes and rewrites only the exact spans you
touch. This is the same "edit in place, preserve everything untouched" philosophy as
the sibling libraries (docxedit / odtedit / sheetedit).

| Format | Editing | Notes |
|---|---|---|
| GeoJSON (`FeatureCollection`) | full, byte-lossless | properties, geometry, add/delete, style |
| KML / KMZ | full, byte-lossless | geometry (point/line/polygon), name/description, colour, add/delete |
| GPX | byte-lossless | waypoint + single-segment track/route reshape, name/description, add/delete |
| TopoJSON / WKT / Shapefile | view-only | export to edit |

## API

```ts
function createGeoEditor(
  container: HTMLElement,
  input: { text?: string; bytes?: Uint8Array; filename?: string },
  opts?: {
    filename?: string;
    editable?: boolean;                                   // override the auto-detected default
    onChange?: () => void;
    onExport?: (name: string, bytes: Uint8Array) => void; // default: browser download
    onError?: (message: string) => void;                  // default: console.error
  },
): {
  getText(): string;
  getBytes(): Uint8Array | undefined;                     // .kmz
  destroy(): void;
};
```

Pass `text` for text formats and `bytes` for `.kmz`. The format is detected from the
content and file name. The pure edit helpers (`applyPropertyEdit`, `setKmlGeometry`,
`buildKmlDocument`, …) are also exported for headless use.

## Runtime dependencies

[`geojs`](https://github.com/OpenGeoscience/geojs) (map, Apache-2.0),
[`@tmcw/togeojson`](https://github.com/placemark/togeojson) (KML/GPX → GeoJSON, ISC),
[`saxes`](https://github.com/lddubeau/saxes) (position-aware XML, ISC),
[`jsonc-parser`](https://github.com/microsoft/node-jsonc-parser) (JSON CST, MIT),
[`fflate`](https://github.com/101arrowz/fflate) (KMZ zip, MIT),
[`topojson-client`](https://github.com/topojson/topojson-client) (MIT),
[`wellknown`](https://github.com/mapbox/wellknown) (WKT, ISC),
[`shpjs`](https://github.com/calvinmetcalf/shapefile-js) (shapefile, MIT),
[`hammerjs`](https://github.com/hammerjs/hammer.js) (touch, MIT).

## Develop

```bash
npm install
npm run dev       # demo at localhost:5173
npm test          # unit tests (byte-lossless splices, measure math)
npm run test:e2e  # Cypress end-to-end tests over the demo
npm run build     # emit dist/ (tsc)
```

**Two TypeScripts, on purpose.** The typecheck runs TypeScript 7, the native compiler, aliased as
`tsgo` and called by path; `typescript` itself stays on 6. TypeScript 7's package is a launcher for
a binary and exposes no JS compiler API, which Cypress needs to compile its specs, so with 7 under
that name every e2e spec fails to bundle. Keeping both gives the fast typecheck and a working suite.

## License

MIT
