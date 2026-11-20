// Terrio Toolbox: an ArcGIS Pro-style Geoprocessing pane for GeoLibre, running terrio
// (pure-Rust GDAL-class geoprocessing compiled to WebAssembly) in a Web Worker.
import { TOOLBOXES, TOOLS } from "./tools.js";
import { createPane, h, fmtSec, RAIL_ICON } from "./ui.js";

const ID = "terrio-toolbox";
const VERSION = "0.2.2";
const TERRIO_VERSION = "0.9.0";
const PANEL = "terrio-toolbox-geoprocessing";
const WASM_CDN = `https://cdn.jsdelivr.net/npm/terrio-js@${TERRIO_VERSION}/terrio_bg.wasm`;
// eslint-disable-next-line no-undef
const WORKER_SRC = __WORKER_SRC__;

const S = {
  app: null,
  worker: null,
  ready: null,
  engine: "",
  engineWatchers: new Set(),
  nextId: 1,
  pending: new Map(),
  history: [],
  files: [], // rasters picked with Browse: { key, name, bytes }
  rasterOut: new Map(), // GeoLibre layer id -> { name, bytes } of rasters this plugin added
  pane: null,
  pendingTool: null,
  dispose: [],
};

// ------------------------------------------------------------------ engine (worker)
async function wasmBytes() {
  const app = S.app;
  try {
    const bytes = await app.readPluginAsset?.(ID, "terrio_bg.wasm");
    if (bytes?.byteLength) return { bytes, from: "plugin bundle" };
  } catch {
    /* fall through */
  }
  const url = app.resolvePluginAssetUrl?.(ID, "terrio_bg.wasm");
  for (const [u, from] of [[url, "plugin URL"], [WASM_CDN, "jsDelivr"]]) {
    if (!u) continue;
    try {
      const res = await fetch(u);
      if (res.ok) return { bytes: new Uint8Array(await res.arrayBuffer()), from };
    } catch {
      /* try the next */
    }
  }
  throw new Error("Could not load the terrio engine (terrio_bg.wasm)");
}

function setEngine(text) {
  S.engine = text;
  for (const f of S.engineWatchers) f();
}

function engine() {
  if (S.ready) return S.ready;
  setEngine("terrio engine: loading…");
  S.ready = (async () => {
    const t0 = performance.now();
    const { bytes, from } = await wasmBytes();
    const blobUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
    const worker = new Worker(blobUrl);
    URL.revokeObjectURL(blobUrl);
    worker.onmessage = (e) => {
      const m = e.data;
      const p = S.pending.get(m.id);
      if (!p) return;
      if (m.log !== undefined) return p.onLog?.(m.log);
      S.pending.delete(m.id);
      if (m.ok) p.resolve(m);
      else p.reject(new Error(m.error));
    };
    worker.onerror = (e) => {
      for (const p of S.pending.values()) p.reject(new Error(e.message || "terrio worker failed"));
      S.pending.clear();
    };
    S.worker = worker;
    const mb = (bytes.byteLength / 1e6).toFixed(0); // read before the buffer moves to the worker
    const buf = bytes.buffer.byteLength === bytes.byteLength ? bytes.buffer : bytes.slice().buffer;
    const r = await call({ type: "init", wasm: buf }, [buf]);
    setEngine(`terrio ${r.version} · ${mb} MB WebAssembly from ${from} · ready in ${fmtSec(performance.now() - t0)} s`);
    return r;
  })().catch((e) => {
    killWorker();
    setEngine(`terrio engine: ${e.message}`);
    throw e;
  });
  return S.ready;
}

function call(msg, transfer = [], onLog) {
  const id = S.nextId++;
  return new Promise((resolve, reject) => {
    S.pending.set(id, { resolve, reject, onLog });
    S.worker.postMessage({ ...msg, id }, transfer);
  });
}

function killWorker() {
  S.worker?.terminate();
  S.worker = null;
  S.ready = null;
  for (const p of S.pending.values()) p.reject(new Error("Cancelled"));
  S.pending.clear();
}

// ------------------------------------------------------------------ GeoLibre layers
function snapshotLayers() {
  try {
    return S.app.getProjectSnapshot?.()?.layers ?? [];
  } catch {
    return [];
  }
}
const GEOM = { Point: "point", MultiPoint: "point", LineString: "line", MultiLineString: "line", Polygon: "polygon", MultiPolygon: "polygon" };

function vectorLayers(geom) {
  const out = [];
  for (const l of S.app.listLayers?.() ?? []) {
    if (l.type !== "geojson") continue;
    let kind = "any";
    try {
      const f = (S.app.getLayerFeatures?.(l.id) ?? []).find((x) => x.geometry);
      kind = GEOM[f?.geometry?.type] ?? "any";
    } catch {
      /* unknown */
    }
    if (geom && kind !== geom) continue;
    out.push({ key: `L:${l.id}`, id: l.id, name: l.name, kind });
  }
  return out;
}

/**
 * Rasters a tool can read. GeoLibre does not hand plugins the bytes of a raster opened from a
 * local file (the project snapshot drops its blob URL), so those are listed as needing the file
 * to be picked with Browse; rasters this plugin made, and rasters added from a URL, read directly.
 */
function rasterLayers() {
  const files = S.files.map((f) => ({ key: f.key, name: f.name, file: f, readable: true }));
  const layers = snapshotLayers()
    .filter((l) => l.type === "cog")
    .map((l) => {
      const own = S.rasterOut.get(l.id);
      const src = typeof l.source?.url === "string" && /^(https?|blob):/.test(l.source.url) ? l.source.url : "";
      const url = l.metadata?.localBytesUrl || src;
      return { key: `L:${l.id}`, id: l.id, name: l.name, url, own, readable: !!(own || url) };
    });
  return [...layers, ...files];
}

function fieldsOf(layerKey, numeric) {
  const id = layerKey?.startsWith("L:") ? layerKey.slice(2) : null;
  if (!id) return [];
  const feats = S.app.getLayerFeatures?.(id) ?? [];
  const props = feats.find((f) => f.properties)?.properties ?? {};
  return Object.keys(props).filter((k) => !k.startsWith("__") && (!numeric || typeof props[k] === "number"));
}

async function vectorInput(key, log) {
  const id = key.slice(2);
  const layer = (S.app.listLayers?.() ?? []).find((l) => l.id === id);
  let features = S.app.getLayerFeatures?.(id) ?? [];
  // As in ArcGIS, a tool works on the selected features of its input when there is a selection.
  if (S.app.getSelectedLayerId?.() === id) {
    const sel = S.app.getSelectedFeatures?.() ?? [];
    if (sel.length) {
      log(`Using ${sel.length} selected feature(s) of ${layer?.name ?? id}`);
      features = sel;
    }
  }
  features = features.filter((f) => f.geometry);
  if (!features.length) throw new Error(`${layer?.name ?? id} has no features`);
  return { name: layer?.name ?? "layer", geojson: { type: "FeatureCollection", features } };
}

async function rasterInput(key) {
  const file = S.files.find((f) => f.key === key);
  if (file) return { filename: file.name, bytes: file.bytes.slice().buffer };
  const l = rasterLayers().find((r) => r.key === key);
  if (!l) throw new Error("The raster layer is no longer on the map");
  if (l.own) return { filename: `${l.own.name.replace(/[^\w.-]+/g, "_")}.tif`, bytes: l.own.bytes.slice().buffer };
  if (!l.url) throw new Error(`GeoLibre does not share the file behind "${l.name}" with plugins. Click the folder button and pick the same file.`);
  const res = await fetch(l.url);
  if (!res.ok) throw new Error(`Could not read ${l.name} (${res.status})`);
  const name = /\.(tiff?|img|asc|jp2|nc|vrt|png|jpg)$/i.test(l.name) ? l.name : `${l.name}.tif`;
  return { filename: name.replace(/[^\w.-]+/g, "_"), bytes: await res.arrayBuffer() };
}

function pickRasterFile(done) {
  const input = h("input", { type: "file", accept: ".tif,.tiff,.img,.asc,.jp2,.nc,.vrt,.hgt,.dem,.bil,.envi,.grd,.png,.jpg" });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const f = { key: `F:${Date.now()}:${file.name}`, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    S.files.push(f);
    done(f);
  });
  input.click();
}

// ------------------------------------------------------------------ run
const stamp = (d = new Date()) => d.toString().replace(/ GMT.*$/, "");
const BLOBS = (globalThis.__terrioToolboxBlobs ??= new Set());

/** Runs a tool; returns its history record and reports progress through hooks.onUpdate. */
function execute(tool, state, hooks = {}) {
  const start = new Date();
  const t0 = performance.now();
  const run = { tool, state, start, status: "running", messages: [], elapsed: 0, files: [], outputs: [] };
  S.history.unshift(run);
  const update = () => hooks.onUpdate?.(run);
  const log = (text) => {
    run.messages.push(text);
    update();
  };
  const tick = setInterval(() => {
    run.elapsed = performance.now() - t0;
    update();
  }, 100);
  (async () => {
    const args = tool.params.map((d) => {
      const v = state[d.name];
      if (d.type === "fc") return vectorLayers().find((l) => l.key === v)?.name ?? "#";
      if (d.type === "raster") return rasterLayers().find((l) => l.key === v)?.name ?? "#";
      if (Array.isArray(v)) return v.join(";") || "#";
      return v === "" || v == null ? "#" : String(v);
    });
    log(`Executing: ${tool.name.replace(/\s+/g, "")} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
    log(`Start Time: ${stamp(start)}`);
    try {
      if (!S.ready) log("Loading the terrio engine…");
      await engine();
      const params = {};
      const transfer = [];
      for (const d of tool.params) {
        const v = state[d.name];
        if (d.type === "fc") params[d.name] = v ? await vectorInput(v, log) : "";
        else if (d.type === "raster") {
          if (v) {
            const r = await rasterInput(v);
            params[d.name] = r;
            transfer.push(r.bytes);
          } else params[d.name] = "";
        } else if (d.type === "rasters") {
          params[d.name] = [];
          for (const k of v ?? []) {
            const r = await rasterInput(k);
            params[d.name].push(r);
            transfer.push(r.bytes);
          }
        } else params[d.name] = v;
      }
      const r = await call({ type: "run", tool: tool.id, params }, transfer, log);
      for (const o of r.results) await addOutput(o, log, run);
      run.elapsed = performance.now() - t0;
      log(`terrio: ${fmtSec(r.timing.run)} s processing, ${fmtSec(r.timing.open)} s reading inputs, ${fmtSec(r.timing.write)} s writing outputs`);
      log(`Succeeded at ${stamp()} (Elapsed Time: ${fmtSec(run.elapsed)} seconds)`);
      run.status = "ok";
    } catch (e) {
      run.elapsed = performance.now() - t0;
      const msg = String(e.message ?? e);
      log(`ERROR: ${msg}`);
      if (/unreachable|memory|allocate/i.test(msg)) {
        // A WebAssembly memory panic leaves the module unusable: start a fresh engine next run.
        killWorker();
        log("The data did not fit the 4 GB WebAssembly memory. The engine has been restarted; try a smaller extent or cell size.");
      }
      log(`Failed to execute (${tool.name}).`);
      log(`Failed at ${stamp()} (Elapsed Time: ${fmtSec(run.elapsed)} seconds)`);
      run.status = "error";
    } finally {
      clearInterval(tick);
      update();
    }
  })();
  return run;
}

async function addOutput(o, log, run) {
  if (o.kind === "vector") {
    S.app.addGeoJsonLayer(o.name, o.geojson);
    log(`Output: ${o.name} (${o.count} features) added to the map`);
  } else if (o.kind === "raster") {
    const url = URL.createObjectURL(new Blob([o.bytes], { type: "image/tiff" }));
    BLOBS.add(url);
    const st = o.style ?? {};
    const opts = { zoomTo: false, colormap: st.colormap ?? "viridis" };
    const min = st.rescaleMin ?? o.stats?.min;
    const max = st.rescaleMax ?? o.stats?.max;
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) Object.assign(opts, { rescaleMin: min, rescaleMax: max });
    const layerId = await S.app.addCogLayer?.(o.name, url, opts);
    // Keep the bytes so later tools can use this output (GeoLibre does not hand them back).
    if (layerId) S.rasterOut.set(layerId, { name: o.name, bytes: o.bytes });
    log(`Output: ${o.name} (${o.size.join(" x ")} cells, ${o.crs}${o.stats ? `, ${o.stats.min.toFixed(3)} to ${o.stats.max.toFixed(3)}` : ""}) added to the map`);
  } else if (o.kind === "file") {
    // Saving needs a click of the user's own (the save dialog will not open from a finished
    // background job), so the pane offers a Save button for each file.
    run.files.push(o);
    log(`Output: ${o.name} (${(o.bytes.length / 1e6).toFixed(1)} MB) is ready: click Save`);
  }
}

/** Save a file the way GeoLibre does: the system Save As dialog, or a download where there is none. */
async function saveFile(file, run) {
  const log = (t) => run.messages.push(t);
  const ext = file.name.includes(".") ? file.name.slice(file.name.indexOf(".")) : "";
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: file.name, types: ext ? [{ description: ext.slice(1).toUpperCase(), accept: { "application/octet-stream": [ext] } }] : undefined });
      const w = await handle.createWritable();
      await w.write(file.bytes);
      await w.close();
      log(`Saved ${handle.name}`);
      return;
    } catch (e) {
      if (e?.name === "AbortError") return;
      log(`Save dialog unavailable (${e?.message ?? e}); downloading instead`);
    }
  }
  const url = URL.createObjectURL(new Blob([file.bytes]));
  const a = h("a", { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  log(`Downloaded ${file.name}`);
}

// ------------------------------------------------------------------ pane + plugin
function openPane(toolId) {
  S.pendingTool = toolId ?? null;
  S.app.openRightPanel?.(PANEL);
  if (S.pane && toolId) S.pane.openTool(toolId);
}

const api = {
  vectorLayers,
  rasterLayers,
  fieldsOf,
  pickRasterFile,
  execute,
  saveFile,
  history: () => S.history,
  cancel: () => killWorker(),
  selectedLayerId: () => S.app.getSelectedLayerId?.() ?? null,
  engineStatus: () => S.engine || "terrio engine: starts when the pane opens",
  onEngine(f) {
    S.engineWatchers.add(f);
  },
  reveal: () => S.app.openRightPanel?.(PANEL),
};

const plugin = {
  id: ID,
  name: "Terrio Toolbox",
  version: VERSION,
  activate(app) {
    S.app = app;
    const off = app.registerRightPanel?.({
      id: PANEL,
      title: "Terrio Toolbox",
      dock: "replace-style",
      icon: RAIL_ICON,
      defaultWidth: 380,
      render(container) {
        S.pane = createPane(container, api);
        engine().catch(() => {});
        if (S.pendingTool) S.pane.openTool(S.pendingTool);
        S.pendingTool = null;
        return () => {
          S.pane?.destroy();
          S.pane = null;
        };
      },
    });
    if (typeof off === "function") S.dispose.push(off);
    // Like ArcMap's ArcToolbox window: docked on the right and open as soon as the plugin is on,
    // including when GeoLibre starts with the plugin already active. The host may still be laying
    // out its sidebars during activation, so try again shortly if the first call is refused.
    const open = () => app.openRightPanel?.(PANEL);
    if (!open()) {
      const retry = setTimeout(open, 600);
      S.dispose.push(() => clearTimeout(retry));
    }
    const toolItems = (box) => TOOLS.filter((t) => t.box === box.id).map((t) => ({ id: `tool-${t.id}`, label: `${t.name}…`, onSelect: () => openPane(t.id) }));
    const items = [
      { id: "geoprocessing", label: "Geoprocessing", onSelect: () => openPane() },
      { id: "history", label: "History", onSelect: () => (openPane(), S.pane?.showTab("history")) },
      ...TOOLBOXES.map((box) => ({ type: "submenu", id: `box-${box.id}`, label: box.name, items: toolItems(box) })),
    ];
    const off1 = app.registerToolbarMenu?.({ id: `${ID}-menu`, label: "Terrio Toolbox", items });
    if (typeof off1 === "function") S.dispose.push(off1);
    const off2 = app.registerMenuContribution?.({ id: `${ID}-processing`, menu: "processing", items: [{ id: "tt-open", label: "Terrio Toolbox (Geoprocessing)…", onSelect: () => openPane() }] });
    if (typeof off2 === "function") S.dispose.push(off2);
  },
  deactivate(app) {
    app?.closeRightPanel?.(PANEL);
    for (const d of S.dispose.splice(0)) {
      try {
        d();
      } catch (e) {
        console.warn("[Terrio Toolbox] cleanup", e);
      }
    }
    killWorker();
    S.app = null;
    S.files = [];
    S.engineWatchers.clear();
  },
};

export default plugin;
