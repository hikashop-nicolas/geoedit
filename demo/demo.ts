import { createGeoEditor, type GeoEditorHandle } from "../src/index";

const editorEl = document.getElementById("editor")!;
const fileInput = document.getElementById("file") as HTMLInputElement;
let handle: GeoEditorHandle | null = null;

async function open(file: File): Promise<void> {
  handle?.destroy();
  editorEl.textContent = "";
  const isBinary = /\.(kmz|zip|shp)$/i.test(file.name);
  const input = isBinary
    ? { bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name }
    : { text: await file.text(), filename: file.name };
  handle = createGeoEditor(editorEl, input, {
    onChange: () => console.log("edited"),
  });
  (window as unknown as Record<string, unknown>).geoHandle = handle; // handy in the console
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void open(f);
});

// Drop a file anywhere on the page.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) void open(f);
});
