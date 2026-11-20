// Terrio Toolbox: an ArcMap-style ArcToolbox for GeoLibre, running terrio (pure-Rust GDAL-class
// geoprocessing compiled to WebAssembly) in a Web Worker.
import { TOOLBOXES, TOOLS, fillName } from "./tools.js";

const ID = "terrio-toolbox";
const VERSION = "0.1.4";
const TERRIO_VERSION = "0.9.0";
const WASM_CDN = `https://cdn.jsdelivr.net/npm/terrio-js@${TERRIO_VERSION}/terrio_bg.wasm`;
// eslint-disable-next-line no-undef
const WORKER_SRC = __WORKER_SRC__;

const S = {
  app: null,
  worker: null,
  ready: null,
  engine: "",
  nextId: 1,
  pending: new Map(),
  wins: new Map(),
  z: 1000,
  results: [],
  files: [], // rasters picked with Browse: { key, name, bytes }
  rasterOut: new Map(), // GeoLibre layer id -> { name, bytes } of rasters this plugin added
  dispose: [],
  expanded: new Set(["analysis"]),
  search: "",
};

// ------------------------------------------------------------------ icons
const svg = (body, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
const ICON = {
  toolbox: svg('<rect x="1.5" y="5" width="13" height="9" rx="1" fill="#c0392b" stroke="#7b1f16"/><rect x="1.5" y="5" width="13" height="3" fill="#e05545" stroke="#7b1f16"/><path d="M5.5 5V3.2h5V5" fill="none" stroke="#7b1f16" stroke-width="1.3"/><rect x="7" y="7" width="2" height="2" fill="#f5d76e" stroke="#7b1f16" stroke-width=".6"/>'),
  toolset: svg('<rect x="2.5" y="6" width="11" height="7.5" rx="1" fill="#e8a33d" stroke="#8a5a12"/><rect x="2.5" y="6" width="11" height="2.4" fill="#f3c46b" stroke="#8a5a12"/><path d="M6 6V4.4h4V6" fill="none" stroke="#8a5a12" stroke-width="1.2"/>'),
  tool: svg('<path d="M9.6 2.2l4.2 4.2-1.6 1.6-1.3-1.3-6.8 6.8a1.1 1.1 0 01-1.6-1.6l6.8-6.8-1.3-1.3z" fill="#7a8a99" stroke="#3b4652" stroke-width=".7"/><path d="M10.9 1.4l3.7 3.7" stroke="#c0392b" stroke-width="1.6"/>'),
  folder: svg('<path d="M1.5 4h5l1.5 1.5h6.5v8h-13z" fill="#f2c94c" stroke="#9a7a12"/>'),
  ok: svg('<circle cx="8" cy="8" r="6.5" fill="#2e9e44"/><path d="M5 8.3l2 2 4-4.3" stroke="#fff" stroke-width="1.8" fill="none"/>'),
  err: svg('<circle cx="8" cy="8" r="6.5" fill="#d9363e"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" stroke-width="1.8"/>'),
  run: svg('<circle cx="8" cy="8" r="6.5" fill="none" stroke="#1f6fd1" stroke-width="2" stroke-dasharray="30 12"/>'),
  results: svg('<rect x="2" y="2" width="12" height="12" rx="1" fill="#fff" stroke="#556"/><path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h5" stroke="#1f6fd1" stroke-width="1.2"/>'),
};
const menuIcon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${ICON.toolbox.replace(/<\/?svg[^>]*>/g, "")}</svg>`)}`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const h = (tag, attrs = {}, html = "") => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  if (html) el.innerHTML = html;
  return el;
};
const fmtSec = (ms) => (ms / 1000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const stamp = (d = new Date()) => d.toString().replace(/ GMT.*$/, "");

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

function engine() {
  if (S.ready) return S.ready;
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
    S.engine = `terrio ${r.version} engine ready (${mb} MB WebAssembly from ${from}, ${fmtSec(performance.now() - t0)} s)`;
    return r;
  })().catch((e) => {
    S.ready = null;
    killWorker();
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
  // As in ArcMap, a tool works on the selected features of its input when there is a selection.
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
  if (file) return { filename: file.name, bytes: file.bytes.slice().buffer, name: file.name.replace(/\.[^.]+$/, "") };
  const l = rasterLayers().find((r) => r.key === key);
  if (!l) throw new Error("The raster layer is no longer on the map");
  if (l.own) return { filename: `${l.own.name.replace(/[^\w.-]+/g, "_")}.tif`, bytes: l.own.bytes.slice().buffer, name: l.own.name };
  if (!l.url) throw new Error(`GeoLibre does not share the file behind "${l.name}" with plugins. Click the folder button and pick the same file.`);
  const res = await fetch(l.url);
  if (!res.ok) throw new Error(`Could not read ${l.name} (${res.status})`);
  const name = /\.(tiff?|img|asc|jp2|nc|vrt|png|jpg)$/i.test(l.name) ? l.name : `${l.name}.tif`;
  return { filename: name.replace(/[^\w.-]+/g, "_"), bytes: await res.arrayBuffer(), name: l.name.replace(/\.[^.]+$/, "") };
}

// ------------------------------------------------------------------ windows
function bringToFront(win) {
  win.style.zIndex = String(++S.z);
}

function openWindow({ id, title, icon = "", width = 420, height, x, y, cls = "", onClose }) {
  const existing = S.wins.get(id);
  if (existing?.el.isConnected) {
    bringToFront(existing.el);
    return existing;
  }
  const el = h("div", { class: `tt-win ${cls}`, role: "dialog", "aria-label": title });
  const bar = h("div", { class: "tt-title" }, `<span class="tt-title-icon">${icon}</span><span class="tt-title-text">${esc(title)}</span>`);
  const close = h("button", { class: "tt-x", type: "button", title: "Close", "aria-label": "Close" }, "&#x2715;");
  bar.append(close);
  const body = h("div", { class: "tt-body" });
  el.append(bar, body);
  document.body.append(el);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  el.style.width = `${Math.min(width, vw - 20)}px`;
  if (height) el.style.height = `${Math.min(height, vh - 60)}px`;
  el.style.left = `${Math.max(8, x ?? (vw - Math.min(width, vw - 20)) / 2)}px`;
  el.style.top = `${Math.max(48, y ?? 90)}px`;
  bringToFront(el);
  el.addEventListener("pointerdown", () => bringToFront(el));
  bar.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".tt-x")) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    bar.setPointerCapture(e.pointerId);
    const move = (ev) => {
      el.style.left = `${Math.min(window.innerWidth - 60, Math.max(-r.width + 80, ev.clientX - dx))}px`;
      el.style.top = `${Math.min(window.innerHeight - 30, Math.max(0, ev.clientY - dy))}px`;
    };
    const up = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
  });
  const win = { id, el, body, close: () => closeWin(id) };
  close.addEventListener("click", () => win.close());
  win.onClose = onClose;
  S.wins.set(id, win);
  return win;
}

function closeWin(id) {
  const w = S.wins.get(id);
  if (!w) return;
  w.onClose?.();
  w.el.remove();
  S.wins.delete(id);
}

// ------------------------------------------------------------------ ArcToolbox window
function openToolbox() {
  engine().catch(() => {}); // warm the engine while the user picks a tool
  const win = openWindow({ id: "arctoolbox", title: "ArcToolbox", icon: ICON.toolbox, width: 300, height: 520, x: 64, y: 70, cls: "tt-toolbox" });
  renderToolbox(win);
}

function renderToolbox(win) {
  win.body.innerHTML = "";
  const search = h("input", { class: "tt-search", type: "search", placeholder: "Search tools", value: S.search, "aria-label": "Search tools" });
  search.addEventListener("input", () => {
    S.search = search.value;
    renderTree(tree);
  });
  const tree = h("div", { class: "tt-tree", role: "tree" });
  const status = h("div", { class: "tt-status" }, S.engine ? esc(S.engine) : "terrio engine: loading…");
  win.body.append(search, tree, status);
  renderTree(tree);
  S.ready?.then(() => {
    if (status.isConnected) status.textContent = S.engine;
  }).catch((e) => {
    if (status.isConnected) status.textContent = `terrio engine: ${e.message}`;
  });
}

function renderTree(tree) {
  tree.innerHTML = "";
  const q = S.search.trim().toLowerCase();
  const root = h("div", { class: "tt-node tt-root" }, `${ICON.toolbox}<span>ArcToolbox</span>`);
  tree.append(root);
  for (const box of TOOLBOXES) {
    const tools = TOOLS.filter((t) => t.box === box.id && (!q || t.name.toLowerCase().includes(q)));
    if (q && !tools.length) continue;
    const open = q || S.expanded.has(box.id);
    tree.append(treeRow(1, open, ICON.toolbox, box.name, () => toggle(box.id, tree)));
    if (!open) continue;
    for (const set of box.sets) {
      const inSet = tools.filter((t) => t.set === set);
      if (!inSet.length) continue;
      const key = `${box.id}/${set}`;
      const setOpen = q || S.expanded.has(key);
      tree.append(treeRow(2, setOpen, ICON.toolset, set, () => toggle(key, tree)));
      if (!setOpen) continue;
      for (const t of inSet) {
        const row = treeRow(3, null, ICON.tool, t.name, () => openTool(t.id));
        row.title = t.help;
        tree.append(row);
      }
    }
  }
}

function treeRow(depth, open, icon, label, onOpen) {
  const twisty = open === null ? '<span class="tt-twisty-none"></span>' : `<span class="tt-twisty">${open ? "&minus;" : "+"}</span>`;
  const row = h("div", { class: `tt-node tt-d${depth}`, role: "treeitem", tabindex: "0", "aria-expanded": open === null ? false : String(open) }, `${twisty}${icon}<span>${esc(label)}</span>`);
  if (open === null) {
    row.addEventListener("dblclick", onOpen);
    row.addEventListener("keydown", (e) => e.key === "Enter" && onOpen());
  } else {
    row.addEventListener("click", onOpen);
    row.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen()));
  }
  return row;
}

function toggle(key, tree) {
  if (S.expanded.has(key)) S.expanded.delete(key);
  else S.expanded.add(key);
  renderTree(tree);
}

// ------------------------------------------------------------------ tool dialog
const CRS_PRESETS = [
  ["", "(same as input)"],
  ["EPSG:4326", "WGS 1984 (EPSG:4326)"],
  ["EPSG:3857", "WGS 1984 Web Mercator (EPSG:3857)"],
  ["UTM", "UTM zone of the data (auto)"],
  ["EPSG:32746", "WGS 1984 UTM 46N"],
  ["EPSG:32647", "WGS 1984 UTM 47N"],
  ["EPSG:32748", "WGS 1984 UTM 48S"],
  ["EPSG:32749", "WGS 1984 UTM 49S"],
  ["EPSG:32750", "WGS 1984 UTM 50S"],
  ["EPSG:4755", "DGN 1995 (EPSG:4755)"],
  ["EPSG:23830", "DGN95 / Indonesia TM-3 zone 46.2"],
];

function openTool(toolId) {
  const tool = TOOLS.find((t) => t.id === toolId);
  const win = openWindow({ id: `tool:${tool.id}`, title: tool.name, icon: ICON.tool, width: 640, cls: "tt-dialog" });
  win.body.innerHTML = "";
  const state = win.state ?? {};
  win.state = state;
  const form = h("div", { class: "tt-form" });
  const help = h("div", { class: "tt-help" });
  const main = h("div", { class: "tt-dialog-main" });
  main.append(form, help);
  const showHelp = (title, text) => {
    help.innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p>`;
  };
  showHelp(tool.name, tool.help);
  let helpOpen = true;

  const controls = {};
  const outNameOf = () => {
    const names = {};
    for (const def of tool.params) {
      const v = state[def.name];
      if (def.type === "fc") names[def.name] = vectorLayers().find((l) => l.key === v)?.name;
      if (def.type === "raster") names[def.name] = rasterLayers().find((l) => l.key === v)?.name?.replace(/\.[^.]+$/, "");
      if (def.type === "enum" || def.type === "text") names[def.name] = names[def.name] ?? (typeof v === "string" ? v : undefined);
    }
    return names;
  };
  const refreshOut = () => {
    const def = tool.params.find((d) => d.name === "out");
    if (!def || state.outEdited) return;
    state.out = fillName(def.default, outNameOf());
    if (controls.out) controls.out.value = state.out;
  };

  const renderForm = () => {
    form.innerHTML = "";
    for (const def of tool.params) {
      const row = h("div", { class: "tt-param" });
      const label = h("label", { class: "tt-label" }, `${def.required ? '<span class="tt-req" title="Required">&#9679;</span>' : '<span class="tt-req tt-opt"></span>'}${esc(def.label)}`);
      row.append(label);
      const focusHelp = () => showHelp(def.label, def.help ?? tool.help);
      let input;
      if (def.type === "fc" || def.type === "raster") {
        const list = def.type === "fc" ? vectorLayers(def.geom) : rasterLayers();
        input = h("select", { class: "tt-input" });
        input.append(h("option", { value: "" }, def.required ? "" : "(none)"));
        for (const l of list) input.append(h("option", { value: l.key }, esc(l.readable === false ? `${l.name} (pick file)` : l.name)));
        if (state[def.name] === undefined) {
          const sel = S.app.getSelectedLayerId?.();
          const preferred = list.find((l) => l.id === sel) ?? (def.required ? list[0] : null);
          state[def.name] = preferred?.key ?? "";
        }
        input.value = state[def.name];
        input.addEventListener("change", () => {
          state[def.name] = input.value;
          refreshOut();
          renderForm();
        });
        const wrap = h("div", { class: "tt-row" });
        wrap.append(input);
        if (def.type === "raster") {
          const browse = h("button", { class: "tt-browse", type: "button", title: "Browse for a raster file", "aria-label": "Browse" }, ICON.folder);
          browse.addEventListener("click", () => pickRasterFile((f) => {
            state[def.name] = f.key;
            refreshOut();
            renderForm();
          }));
          wrap.append(browse);
        }
        if (!list.length) wrap.append(h("span", { class: "tt-note" }, def.type === "fc" ? `No ${def.geom ?? "feature"} layer on the map` : "No raster layer: use the folder"));
        const chosen = list.find((l) => l.key === state[def.name]);
        if (chosen && chosen.readable === false) wrap.append(h("div", { class: "tt-note tt-block" }, "GeoLibre keeps this local file to itself: click the folder and pick the same file."));
        row.append(wrap);
      } else if (def.type === "rasters") {
        const list = rasterLayers();
        const sel = new Set(state[def.name] ?? []);
        const box = h("div", { class: "tt-checklist" });
        for (const l of list) {
          const id = `${tool.id}-${def.name}-${l.key}`;
          const cb = h("input", { type: "checkbox", id, checked: sel.has(l.key) });
          cb.addEventListener("change", () => {
            if (cb.checked) sel.add(l.key);
            else sel.delete(l.key);
            state[def.name] = [...sel];
          });
          const item = h("label", { class: "tt-check", for: id });
          item.append(cb, document.createTextNode(l.name));
          box.append(item);
        }
        const browse = h("button", { class: "tt-btn tt-small", type: "button" }, `${ICON.folder} Add file…`);
        browse.addEventListener("click", () => pickRasterFile((f) => {
          sel.add(f.key);
          state[def.name] = [...sel];
          renderForm();
        }));
        if (!list.length) box.append(h("div", { class: "tt-note" }, "No raster layer: add files"));
        row.append(box, browse);
        input = box;
      } else if (def.type === "field") {
        const fields = fieldsOf(state[def.of], def.numeric);
        if (def.multi) {
          const sel = new Set(state[def.name] ?? []);
          const box = h("div", { class: "tt-checklist" });
          for (const f of fields) {
            const id = `${tool.id}-${def.name}-${f}`;
            const cb = h("input", { type: "checkbox", id, checked: sel.has(f) });
            cb.addEventListener("change", () => {
              if (cb.checked) sel.add(f);
              else sel.delete(f);
              state[def.name] = [...sel];
            });
            const item = h("label", { class: "tt-check", for: id });
            item.append(cb, document.createTextNode(f));
            box.append(item);
          }
          if (!fields.length) box.append(h("div", { class: "tt-note" }, "Pick the input features first"));
          input = box;
        } else {
          input = h("select", { class: "tt-input" });
          input.append(h("option", { value: "" }, ""));
          for (const f of fields) input.append(h("option", { value: f }, esc(f)));
          if (state[def.name] === undefined || !fields.includes(state[def.name])) state[def.name] = fields[0] ?? "";
          input.value = state[def.name];
          input.addEventListener("change", () => (state[def.name] = input.value));
        }
        row.append(input);
      } else if (def.type === "enum") {
        input = h("select", { class: "tt-input" });
        for (const [lab, val] of def.options) input.append(h("option", { value: val }, esc(lab)));
        state[def.name] ??= def.default;
        input.value = state[def.name];
        input.addEventListener("change", () => {
          state[def.name] = input.value;
          refreshOut();
        });
        row.append(input);
      } else if (def.type === "crs") {
        state[def.name] ??= def.default ?? "";
        const wrap = h("div", { class: "tt-row" });
        const pick = h("select", { class: "tt-input tt-crs-pick", "aria-label": `${def.label} preset` });
        for (const [val, lab] of CRS_PRESETS) {
          if (val === "UTM" && tool.id !== "project_raster") continue;
          if (val === "" && def.required) continue;
          pick.append(h("option", { value: val }, esc(lab)));
        }
        pick.append(h("option", { value: "custom" }, "Other (type an EPSG code)…"));
        const custom = h("input", { class: "tt-input tt-crs", type: "text", value: state[def.name], placeholder: "EPSG:32749", "aria-label": def.label });
        pick.value = CRS_PRESETS.some(([v]) => v === state[def.name]) ? state[def.name] : "custom";
        custom.hidden = pick.value !== "custom";
        pick.addEventListener("change", () => {
          if (pick.value !== "custom") state[def.name] = pick.value;
          custom.hidden = pick.value !== "custom";
          custom.value = state[def.name];
        });
        custom.addEventListener("input", () => (state[def.name] = custom.value.trim()));
        wrap.append(pick, custom);
        row.append(wrap);
        input = pick;
      } else if (def.type === "bool") {
        state[def.name] ??= def.default ?? false;
        const id = `${tool.id}-${def.name}`;
        input = h("input", { type: "checkbox", id, checked: state[def.name] });
        input.addEventListener("change", () => (state[def.name] = input.checked));
        label.textContent = "";
        label.prepend(input);
        label.append(document.createTextNode(` ${def.label}`));
        label.setAttribute("for", id);
      } else {
        state[def.name] ??= def.name === "out" ? fillName(def.default, outNameOf()) : def.default ?? "";
        input = def.multiline
          ? h("textarea", { class: "tt-input tt-area", rows: "4", placeholder: def.placeholder ?? "" })
          : h("input", { class: "tt-input", type: def.type === "number" ? "text" : "text", inputmode: def.type === "number" ? "decimal" : "text", placeholder: def.placeholder ?? "" });
        input.value = def.multiline ? String(state[def.name]).replace(/;/g, "\n") : state[def.name];
        input.addEventListener("input", () => {
          state[def.name] = input.value;
          if (def.name === "out") state.outEdited = true;
        });
        row.append(input);
        if (def.name === "out") controls.out = input;
      }
      input.addEventListener("focus", focusHelp, true);
      form.append(row);
    }
  };
  renderForm();

  const footer = h("div", { class: "tt-footer" });
  const ok = h("button", { class: "tt-btn tt-primary", type: "button" }, "OK");
  const cancel = h("button", { class: "tt-btn", type: "button" }, "Cancel");
  const helpBtn = h("button", { class: "tt-btn tt-helpbtn", type: "button" }, "&lt;&lt; Hide Help");
  helpBtn.addEventListener("click", () => {
    helpOpen = !helpOpen;
    help.hidden = !helpOpen;
    win.el.classList.toggle("tt-nohelp", !helpOpen);
    helpBtn.innerHTML = helpOpen ? "&lt;&lt; Hide Help" : "Show Help &gt;&gt;";
  });
  cancel.addEventListener("click", () => win.close());
  ok.addEventListener("click", () => {
    const missing = tool.params.filter((d) => d.required && (state[d.name] == null || state[d.name] === "" || (Array.isArray(state[d.name]) && !state[d.name].length)));
    if (missing.length) {
      showHelp("Missing parameters", missing.map((d) => d.label).join(", "));
      help.classList.add("tt-help-error");
      if (!helpOpen) helpBtn.click();
      return;
    }
    help.classList.remove("tt-help-error");
    win.close();
    execute(tool, { ...state });
  });
  footer.append(ok, cancel, h("span", { class: "tt-grow" }), helpBtn);
  win.body.append(main, footer);
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

// ------------------------------------------------------------------ run + progress
async function execute(tool, state) {
  const start = new Date();
  const t0 = performance.now();
  const result = { tool: tool.name, start, status: "running", messages: [], elapsed: 0, outputs: [], files: [] };
  S.results.unshift(result);
  const log = (text) => {
    result.messages.push(text);
    renderProgress();
  };
  const win = openWindow({ id: `run:${start.getTime()}`, title: tool.name, icon: ICON.tool, width: 520, y: 140, cls: "tt-progress" });
  win.body.innerHTML = "";
  const head = h("div", { class: "tt-prog-head" });
  const bar = h("div", { class: "tt-bar" }, '<div class="tt-bar-fill"></div>');
  const clock = h("div", { class: "tt-clock" });
  const msgs = h("pre", { class: "tt-msgs", role: "log" });
  const closeWhenDone = h("label", { class: "tt-check" });
  const cb = h("input", { type: "checkbox", checked: localStorage.getItem("tt-autoclose") === "1" });
  cb.addEventListener("change", () => {
    try {
      localStorage.setItem("tt-autoclose", cb.checked ? "1" : "0");
    } catch {
      /* private mode */
    }
  });
  closeWhenDone.append(cb, document.createTextNode(" Close this dialog when completed successfully"));
  const foot = h("div", { class: "tt-footer" });
  const btn = h("button", { class: "tt-btn", type: "button" }, "Cancel");
  foot.append(closeWhenDone, h("span", { class: "tt-grow" }), btn);
  win.body.append(head, bar, clock, msgs, foot);
  let done = false;
  btn.addEventListener("click", () => {
    if (done) return win.close();
    killWorker();
  });
  const tick = setInterval(() => {
    result.elapsed = performance.now() - t0;
    if (clock.isConnected) clock.textContent = `Elapsed Time: ${fmtSec(result.elapsed)} seconds`;
  }, 100);
  function renderProgress() {
    head.innerHTML = `${result.status === "running" ? ICON.run : result.status === "ok" ? ICON.ok : ICON.err}<span>${esc(result.status === "running" ? `Executing ${tool.name}…` : result.status === "ok" ? "Completed" : "Failed")}</span>`;
    msgs.textContent = result.messages.join("\n");
    msgs.scrollTop = msgs.scrollHeight;
    win.el.classList.toggle("tt-running", result.status === "running");
    renderResults();
  }
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
    if (!S.ready) log("Loading the terrio engine (first run)…");
    await engine();
    const params = {};
    const transfer = [];
    for (const d of tool.params) {
      const v = state[d.name];
      if (d.type === "fc") params[d.name] = v ? await vectorInput(v, log) : "";
      else if (d.type === "raster") {
        if (v) {
          const r = await rasterInput(v);
          params[d.name] = { filename: r.filename, bytes: r.bytes };
          transfer.push(r.bytes);
        } else params[d.name] = "";
      } else if (d.type === "rasters") {
        params[d.name] = [];
        for (const k of v ?? []) {
          const r = await rasterInput(k);
          params[d.name].push({ filename: r.filename, bytes: r.bytes });
          transfer.push(r.bytes);
        }
      } else params[d.name] = v;
    }
    log(`Running ${tool.name} with ${S.engine.replace(/ \(.*/, "")}…`);
    const r = await call({ type: "run", tool: tool.id, params }, transfer, log);
    for (const o of r.results) await addOutput(o, log, result);
    result.status = "ok";
    result.elapsed = performance.now() - t0;
    log(`terrio time: ${fmtSec(r.timing.run)} s (read inputs ${fmtSec(r.timing.open)} s, write outputs ${fmtSec(r.timing.write)} s)`);
    log(`Succeeded at ${stamp()} (Elapsed Time: ${fmtSec(result.elapsed)} seconds)`);
  } catch (e) {
    result.status = "error";
    result.elapsed = performance.now() - t0;
    log(`ERROR: ${e.message}`);
    log(`Failed to execute (${tool.name}).`);
    log(`Failed at ${stamp()} (Elapsed Time: ${fmtSec(result.elapsed)} seconds)`);
  } finally {
    done = true;
    clearInterval(tick);
    clock.textContent = `Elapsed Time: ${fmtSec(result.elapsed)} seconds`;
    btn.textContent = "Close";
    for (const file of result.files) {
      const save = h("button", { class: "tt-btn tt-primary", type: "button" }, `${ICON.folder} Save ${esc(file.name)}…`);
      save.addEventListener("click", () => saveFile(file, log));
      btn.before(save);
    }
    renderProgress();
    if (result.status === "ok" && cb.checked && !result.files.length) setTimeout(() => win.close(), 600);
  }
}

const BLOBS = (globalThis.__terrioToolboxBlobs ??= new Set());

async function addOutput(o, log, result) {
  if (o.kind === "vector") {
    S.app.addGeoJsonLayer(o.name, o.geojson);
    log(`Output: ${o.name} (${o.count} features) added to the map`);
    result.outputs.push(`${o.name}: ${o.count} features`);
  } else if (o.kind === "raster") {
    const url = URL.createObjectURL(new Blob([o.bytes], { type: "image/tiff" }));
    BLOBS.add(url);
    const st = o.style ?? {};
    const opts = { zoomTo: false };
    if (st.colormap) opts.colormap = st.colormap;
    const min = st.rescaleMin ?? o.stats?.min;
    const max = st.rescaleMax ?? o.stats?.max;
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) Object.assign(opts, { rescaleMin: min, rescaleMax: max });
    if (!opts.colormap) opts.colormap = "viridis";
    const layerId = await S.app.addCogLayer?.(o.name, url, opts);
    // Keep the bytes so later tools can use this output (GeoLibre does not hand them back).
    if (layerId) S.rasterOut.set(layerId, { name: o.name, bytes: o.bytes });
    log(`Output: ${o.name} (${o.size.join(" x ")} cells, ${o.crs}${o.stats ? `, ${o.stats.min.toFixed(2)} to ${o.stats.max.toFixed(2)}` : ""}) added to the map`);
    result.outputs.push(`${o.name}: ${o.size.join(" x ")} cells`);
  } else if (o.kind === "file") {
    // Saving needs a click of the user's own (the save dialog will not open from a finished
    // background job), so the progress dialog offers a Save button for each file.
    result.files.push(o);
    log(`Output: ${o.name} (${(o.bytes.length / 1024).toFixed(0)} KB) is ready: click Save ${o.name}…`);
    result.outputs.push(`${o.name}`);
  }
}

/** Save a file the way GeoLibre does: the system Save As dialog, or a download where there is none. */
async function saveFile(file, log) {
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

// ------------------------------------------------------------------ Results window
function openResults() {
  const win = openWindow({ id: "results", title: "Results", icon: ICON.results, width: 420, height: 380, x: window.innerWidth - 440, y: 70, cls: "tt-results" });
  renderResults(win);
}

function renderResults(win = S.wins.get("results")) {
  if (!win?.el.isConnected) return;
  win.body.innerHTML = "";
  const list = h("div", { class: "tt-tree tt-reslist" });
  list.append(h("div", { class: "tt-node tt-root" }, `${ICON.folder}<span>Current Session</span>`));
  if (!S.results.length) list.append(h("div", { class: "tt-note tt-d1" }, "No tools run yet"));
  for (const r of S.results) {
    const icon = r.status === "running" ? ICON.run : r.status === "ok" ? ICON.ok : ICON.err;
    const row = h("details", { class: "tt-res" });
    row.append(h("summary", { class: "tt-node tt-d1" }, `${icon}<span>${esc(r.tool)}</span><span class="tt-time">${r.status === "running" ? "running" : `${fmtSec(r.elapsed)} s`}</span>`));
    row.append(h("pre", { class: "tt-msgs tt-small" }, esc([...r.outputs.map((x) => `→ ${x}`), ...r.messages].join("\n"))));
    list.append(row);
  }
  win.body.append(list);
}

// ------------------------------------------------------------------ plugin
const plugin = {
  id: ID,
  name: "Terrio Toolbox",
  version: VERSION,
  activate(app) {
    S.app = app;
    for (const el of document.querySelectorAll(".tt-win")) el.remove();
    const toolItems = (box) => TOOLS.filter((t) => t.box === box.id).map((t) => ({ id: `tool-${t.id}`, label: `${t.name}…`, onSelect: () => openTool(t.id) }));
    const items = [
      { id: "arctoolbox", label: "ArcToolbox", icon: menuIcon, onSelect: openToolbox },
      { id: "results", label: "Results", onSelect: openResults },
      ...TOOLBOXES.map((box) => ({ type: "submenu", id: `box-${box.id}`, label: box.name, items: toolItems(box) })),
    ];
    const off1 = app.registerToolbarMenu?.({ id: `${ID}-menu`, label: "Terrio Toolbox", icon: menuIcon, items });
    if (typeof off1 === "function") S.dispose.push(off1);
    const off2 = app.registerMenuContribution?.({ id: `${ID}-processing`, menu: "processing", items: [{ id: "tt-open", label: "Terrio Toolbox (ArcToolbox)…", icon: menuIcon, onSelect: openToolbox }] });
    if (typeof off2 === "function") S.dispose.push(off2);
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const top = [...S.wins.values()].sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex))[0];
      if (top && !top.el.classList.contains("tt-running") && top.id !== "arctoolbox") {
        e.stopPropagation();
        top.close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    S.dispose.push(() => window.removeEventListener("keydown", onKey, true));
  },
  deactivate() {
    for (const d of S.dispose.splice(0)) {
      try {
        d();
      } catch (e) {
        console.warn("[Terrio Toolbox] cleanup", e);
      }
    }
    for (const id of [...S.wins.keys()]) closeWin(id);
    killWorker();
    S.app = null;
    S.files = [];
  },
};

export default plugin;
