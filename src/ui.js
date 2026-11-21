// Terrio Toolbox UI: an ArcGIS Pro-style Geoprocessing pane docked in GeoLibre's right sidebar,
// drawn in GeoLibre's own theme tokens (black and white, light and dark) with line icons.
// Engine, layer and run helpers come from main.js through the `api` object.
import { TOOLBOXES, TOOLS, fillName } from "./tools.js";
import { FUNCTIONS, translate } from "./mapalgebra.js";
import { INDEXES, BAND_HINT, guessBand } from "./indices.js";

const OPS = [
  [">", "greater than", "gt"],
  [">=", "greater or equal", "ge"],
  ["<", "less than", "lt"],
  ["<=", "less or equal", "le"],
  ["==", "equal to", "eq"],
  ["!=", "not equal to", "ne"],
];
const KEEP = [
  ["both", "True = 1, False = 0"],
  ["true", "True only (1), False = NoData"],
  ["value", "True only, keep the raster's values"],
];

// ------------------------------------------------------------------ icons (stroke = currentColor)
const ic = (d, size = 16) => `<svg class="tt-ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  toolbox: ic('<rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M9 8V5.5h6V8M3 12.5h18M11 12.5v2h2v-2"/>'),
  toolset: ic('<path d="M3 7.5h6l2 2h10v9.5H3z"/>'),
  tool: ic('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>'),
  search: ic('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  back: ic('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  star: ic('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>'),
  starOn: '<svg class="tt-ic" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
  info: ic('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  folder: ic('<path d="M3 7h6l2 2h10v10H3z"/>'),
  run: ic('<path d="M7 5l12 7-12 7z"/>'),
  ok: ic('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.6L16 9.5"/>'),
  err: ic('<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  clock: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  chevron: ic('<path d="M9 6l6 6-6 6"/>', 14),
  save: ic('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>'),
  history: ic('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
};
export const RAIL_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M9 8V5.5h6V8M3 12.5h18M11 12.5v2h2v-2"/></svg>',
)}`;

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const h = (tag, attrs = {}, html = "") => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  if (html) el.innerHTML = html;
  return el;
};
export const fmtSec = (ms) => (ms / 1000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ------------------------------------------------------------------ persisted favourites and recent tools
const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(`terrio-toolbox:${key}`)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`terrio-toolbox:${key}`, JSON.stringify(value));
    } catch {
      /* private mode */
    }
  },
};

const CRS_PRESETS = [
  ["", "Same as input"],
  ["EPSG:4326", "WGS 1984 (EPSG:4326)"],
  ["EPSG:3857", "WGS 1984 Web Mercator (EPSG:3857)"],
  ["UTM", "UTM zone of the data (auto)"],
  ["EPSG:32646", "WGS 1984 UTM 46N"],
  ["EPSG:32647", "WGS 1984 UTM 47N"],
  ["EPSG:32748", "WGS 1984 UTM 48S"],
  ["EPSG:32749", "WGS 1984 UTM 49S"],
  ["EPSG:32750", "WGS 1984 UTM 50S"],
  ["EPSG:4755", "DGN 1995 (EPSG:4755)"],
  ["EPSG:23830", "DGN95 / Indonesia TM-3 zone 46.2"],
];

/**
 * The Geoprocessing pane. `api` supplies vectorLayers, rasterLayers, fieldsOf, pickRasterFile,
 * execute(tool, state, hooks) and engineStatus().
 */
export function createPane(container, api) {
  const P = {
    view: "home", // home | tool
    tab: "toolboxes", // favorites | toolboxes | history; opens on the tree, like ArcToolbox
    search: "",
    expanded: new Set(store.get("expanded", ["analysis"])),
    favorites: new Set(store.get("favorites", [])),
    recent: store.get("recent", []),
    tool: null,
    states: new Map(), // tool id -> parameter values
    run: null, // the current tool's latest run
    showHelp: false,
    details: false,
  };
  const root = h("div", { class: "tt-pane" });
  container.append(root);

  const saveUi = () => {
    store.set("tab", P.tab);
    store.set("expanded", [...P.expanded]);
    store.set("favorites", [...P.favorites]);
    store.set("recent", P.recent.slice(0, 8));
  };

  function render() {
    root.innerHTML = "";
    if (P.view === "tool" && P.tool) renderTool();
    else renderHome();
  }

  // ---------------------------------------------------------------- home: Find Tools + tabs
  function renderHome() {
    const top = h("div", { class: "tt-top" });
    const box = h("label", { class: "tt-find" }, ICON.search);
    const input = h("input", { type: "search", placeholder: "Find Tools", value: P.search, "aria-label": "Find Tools" });
    input.addEventListener("input", () => {
      P.search = input.value;
      renderList(list);
    });
    box.append(input);
    top.append(box);
    const tabs = h("div", { class: "tt-tabs", role: "tablist" });
    for (const [id, label] of [["favorites", "Favorites"], ["toolboxes", "Toolboxes"], ["history", "History"]]) {
      const b = h("button", { class: `tt-tab${P.tab === id ? " is-active" : ""}`, type: "button", role: "tab", "aria-selected": String(P.tab === id) }, label);
      b.addEventListener("click", () => {
        P.tab = id;
        saveUi();
        render();
      });
      tabs.append(b);
    }
    const list = h("div", { class: "tt-list" });
    const foot = h("div", { class: "tt-engine" }, esc(api.engineStatus()));
    root.append(top, tabs, list, foot);
    renderList(list);
    api.onEngine?.(() => {
      if (foot.isConnected) foot.textContent = api.engineStatus();
    });
    if (P.search) input.focus();
  }

  function toolRow(t, depth) {
    const row = h("button", { class: `tt-row tt-d${depth}`, type: "button", title: t.help }, `<span class="tt-twist"></span>${ICON.tool}<span class="tt-name">${esc(t.name)}</span>`);
    if (P.favorites.has(t.id)) row.insertAdjacentHTML("beforeend", `<span class="tt-fav" title="Favorite">${ICON.starOn}</span>`);
    row.addEventListener("click", () => openTool(t.id));
    return row;
  }

  function renderList(list) {
    list.innerHTML = "";
    const q = P.search.trim().toLowerCase();
    if (q) {
      const hits = TOOLS.filter((t) => t.name.toLowerCase().includes(q) || t.help.toLowerCase().includes(q) || t.set.toLowerCase().includes(q));
      list.append(h("div", { class: "tt-head" }, `${hits.length} tool${hits.length === 1 ? "" : "s"}`));
      for (const t of hits) {
        const row = toolRow(t, 0);
        const box = TOOLBOXES.find((b) => b.id === t.box);
        row.append(h("span", { class: "tt-where" }, esc(`${box?.name ?? ""} › ${t.set}`)));
        list.append(row);
      }
      if (!hits.length) list.append(h("div", { class: "tt-empty" }, "No tools match your search."));
      return;
    }
    if (P.tab === "favorites") {
      const favs = TOOLS.filter((t) => P.favorites.has(t.id));
      list.append(h("div", { class: "tt-head" }, "Favorites"));
      if (!favs.length) list.append(h("div", { class: "tt-empty" }, "Star a tool to keep it here."));
      for (const t of favs) list.append(toolRow(t, 0));
      list.append(h("div", { class: "tt-head" }, "Recent"));
      const rec = P.recent.map((id) => TOOLS.find((t) => t.id === id)).filter(Boolean);
      if (!rec.length) list.append(h("div", { class: "tt-empty" }, "Tools you open appear here."));
      for (const t of rec) list.append(toolRow(t, 0));
      return;
    }
    if (P.tab === "history") {
      renderHistory(list);
      return;
    }
    // the root node, like ArcMap's "ArcToolbox"
    list.append(h("div", { class: "tt-row tt-root", role: "presentation" }, `${ICON.toolbox}<span class="tt-name">Terrio Toolbox</span>`));
    for (const box of TOOLBOXES) {
      const open = P.expanded.has(box.id);
      list.append(groupRow(box.id, box.name, ICON.toolbox, open, 0, list));
      if (!open) continue;
      for (const set of box.sets) {
        const tools = TOOLS.filter((t) => t.box === box.id && t.set === set);
        if (!tools.length) continue;
        const key = `${box.id}/${set}`;
        const setOpen = P.expanded.has(key);
        list.append(groupRow(key, set, ICON.toolset, setOpen, 1, list));
        if (setOpen) for (const t of tools) list.append(toolRow(t, 2));
      }
    }
  }

  function groupRow(key, label, icon, open, depth, list) {
    const row = h("button", { class: `tt-row tt-group tt-d${depth}${open ? " is-open" : ""}`, type: "button", "aria-expanded": String(open) }, `<span class="tt-twist">${ICON.chevron}</span>${icon}<span class="tt-name">${esc(label)}</span>`);
    row.addEventListener("click", () => {
      if (P.expanded.has(key)) P.expanded.delete(key);
      else P.expanded.add(key);
      saveUi();
      renderList(list);
    });
    return row;
  }

  function renderHistory(list) {
    const runs = api.history();
    list.append(h("div", { class: "tt-head" }, "Current session"));
    if (!runs.length) list.append(h("div", { class: "tt-empty" }, "Tools you run appear here, with how long each took."));
    for (const r of runs) {
      const item = h("details", { class: "tt-hist" });
      const icon = r.status === "running" ? ICON.clock : r.status === "ok" ? ICON.ok : ICON.err;
      item.append(h("summary", { class: `tt-row tt-hrow is-${r.status}` }, `${icon}<span class="tt-name">${esc(r.tool.name)}</span><span class="tt-time">${r.status === "running" ? "running" : `${fmtSec(r.elapsed)} s`}</span>`));
      item.append(h("pre", { class: "tt-msgs" }, esc(r.messages.join("\n"))));
      const reopen = h("button", { class: "tt-link", type: "button" }, "Open tool with these parameters");
      reopen.addEventListener("click", () => {
        P.states.set(r.tool.id, { ...r.state });
        openTool(r.tool.id);
      });
      item.append(reopen);
      list.append(item);
    }
  }

  // ---------------------------------------------------------------- tool view
  function openTool(id) {
    P.tool = TOOLS.find((t) => t.id === id);
    P.view = "tool";
    P.showHelp = false;
    P.details = false;
    P.run = api.history().find((r) => r.tool.id === id && r.status === "running") ?? null;
    P.recent = [id, ...P.recent.filter((x) => x !== id)].slice(0, 8);
    saveUi();
    api.reveal?.();
    render();
  }

  function renderTool() {
    const tool = P.tool;
    const state = P.states.get(tool.id) ?? {};
    P.states.set(tool.id, state);

    const head = h("div", { class: "tt-toolhead" });
    const back = h("button", { class: "tt-iconbtn", type: "button", title: "Back", "aria-label": "Back" }, ICON.back);
    back.addEventListener("click", () => {
      P.view = "home";
      render();
    });
    const fav = P.favorites.has(tool.id);
    const star = h("button", { class: `tt-iconbtn${fav ? " is-on" : ""}`, type: "button", title: fav ? "Remove from Favorites" : "Add to Favorites", "aria-pressed": String(fav) }, fav ? ICON.starOn : ICON.star);
    star.addEventListener("click", () => {
      if (P.favorites.has(tool.id)) P.favorites.delete(tool.id);
      else P.favorites.add(tool.id);
      saveUi();
      render();
    });
    const info = h("button", { class: `tt-iconbtn${P.showHelp ? " is-on" : ""}`, type: "button", title: "Tool help", "aria-expanded": String(P.showHelp) }, ICON.info);
    info.addEventListener("click", () => {
      P.showHelp = !P.showHelp;
      render();
    });
    const box = TOOLBOXES.find((b) => b.id === tool.box);
    head.append(back, h("div", { class: "tt-tooltitle" }, `<div class="tt-toolname">${esc(tool.name)}</div><div class="tt-crumb">${esc(`${box?.name ?? ""} › ${tool.set}`)}</div>`), star, info);
    root.append(head);
    if (P.showHelp) root.append(h("div", { class: "tt-helpbox" }, esc(tool.help)));

    root.append(h("div", { class: "tt-tabs tt-tabs-tool" }, '<span class="tt-tab is-active">Parameters</span>'));
    const form = h("div", { class: "tt-form" });
    root.append(form);
    renderParams(form, tool, state);

    // footer: status + Run
    const foot = h("div", { class: "tt-foot" });
    root.append(foot);
    renderFooter(foot, tool, state);
  }

  function outNames(tool, state) {
    const names = {};
    for (const def of tool.params) {
      const v = state[def.name];
      if (def.type === "fc") names[def.name] = api.vectorLayers().find((l) => l.key === v)?.name;
      else if (def.type === "raster") names[def.name] = api.rasterLayers().find((l) => l.key === v)?.name?.replace(/\.[^.]+$/, "");
      else if (typeof v === "string") names[def.name] = v;
    }
    return names;
  }

  function renderParams(form, tool, state) {
    form.innerHTML = "";
    const refreshOut = () => {
      const def = tool.params.find((d) => d.name === "out");
      if (!def || state.outEdited) return;
      state.out = fillName(def.default, outNames(tool, state));
      const el = form.querySelector('[data-param="out"]');
      if (el) el.value = state.out;
    };
    for (const def of tool.params) {
      const row = h("div", { class: "tt-param" });
      const id = `tt-${tool.id}-${def.name}`;
      const label = h("label", { class: "tt-label", for: id }, `${esc(def.label)}${def.required ? '<span class="tt-req" aria-label="required">*</span>' : ""}`);
      if (def.help) label.title = def.help;
      if (def.type !== "bool") row.append(label);
      let ctl;
      if (def.type === "fc" || def.type === "raster") {
        const list = def.type === "fc" ? api.vectorLayers(def.geom) : api.rasterLayers();
        ctl = h("select", { class: "tt-input", id });
        ctl.append(h("option", { value: "" }, def.required ? "" : "(none)"));
        for (const l of list) ctl.append(h("option", { value: l.key }, esc(l.readable === false ? `${l.name} (pick file)` : l.name)));
        if (state[def.name] === undefined) {
          const sel = api.selectedLayerId();
          // Only required inputs are filled in for the user; optional ones start empty.
          state[def.name] = def.required ? (list.find((l) => l.id === sel) ?? list.find((l) => l.readable !== false) ?? list[0])?.key ?? "" : "";
        }
        ctl.value = state[def.name];
        ctl.addEventListener("change", () => {
          state[def.name] = ctl.value;
          refreshOut();
          renderParams(form, tool, state);
        });
        const line = h("div", { class: "tt-line" });
        line.append(ctl);
        if (def.type === "raster") {
          const browse = h("button", { class: "tt-iconbtn tt-browse", type: "button", title: "Browse for a raster file", "aria-label": `Browse for ${def.label}` }, ICON.folder);
          browse.addEventListener("click", () => {
            const cur = list.find((l) => l.key === state[def.name]);
            const forLayer = cur?.readable === false ? cur : null;
            api.pickRasterFile((f) => {
              // a file picked for a local layer stands in for it, so the layer stays selected
              state[def.name] = forLayer ? forLayer.key : f.key;
              refreshOut();
              renderParams(form, tool, state);
            }, forLayer);
          });
          line.append(browse);
        }
        row.append(line);
        const chosen = list.find((l) => l.key === state[def.name]);
        if (!list.length) row.append(h("div", { class: "tt-hint" }, def.type === "fc" ? `No ${def.geom ?? "feature"} layer on the map.` : "No raster on the map: use the folder to pick a file."));
        else if (chosen?.readable === false) row.append(h("div", { class: "tt-hint" }, "GeoLibre does not share this local file with plugins: click the folder and choose the same file once."));
      } else if (def.type === "rasters" || (def.type === "field" && def.multi)) {
        const items = def.type === "rasters" ? api.rasterLayers().map((l) => [l.key, l.name]) : api.fieldsOf(state[def.of], def.numeric).map((f) => [f, f]);
        const sel = new Set(state[def.name] ?? []);
        ctl = h("div", { class: "tt-checks", id, role: "group", "aria-label": def.label });
        for (const [val, name] of items) {
          const cid = `${id}-${val}`;
          const cb = h("input", { type: "checkbox", id: cid, checked: sel.has(val) });
          cb.addEventListener("change", () => {
            if (cb.checked) sel.add(val);
            else sel.delete(val);
            state[def.name] = [...sel];
          });
          const item = h("label", { class: "tt-check", for: cid });
          item.append(cb, document.createTextNode(name));
          ctl.append(item);
        }
        if (!items.length) ctl.append(h("div", { class: "tt-hint" }, def.type === "rasters" ? "No raster on the map: add files." : "Pick the input features first."));
        row.append(ctl);
        if (def.type === "rasters") {
          const add = h("button", { class: "tt-btn tt-btn-sm", type: "button" }, `${ICON.folder}<span>Add file…</span>`);
          add.addEventListener("click", () =>
            api.pickRasterFile((f) => {
              state[def.name] = [...sel, f.key];
              renderParams(form, tool, state);
            }),
          );
          row.append(add);
        }
      } else if (def.type === "field") {
        const fields = api.fieldsOf(state[def.of], def.numeric);
        ctl = h("select", { class: "tt-input", id });
        ctl.append(h("option", { value: "" }, ""));
        for (const f of fields) ctl.append(h("option", { value: f }, esc(f)));
        if (!fields.includes(state[def.name])) state[def.name] = fields[0] ?? "";
        ctl.value = state[def.name];
        ctl.addEventListener("change", () => (state[def.name] = ctl.value));
        row.append(ctl);
      } else if (def.type === "enum") {
        ctl = h("select", { class: "tt-input", id });
        for (const [lab, val] of def.options) ctl.append(h("option", { value: val }, esc(lab)));
        state[def.name] ??= def.default;
        ctl.value = state[def.name];
        ctl.addEventListener("change", () => {
          state[def.name] = ctl.value;
          refreshOut();
        });
        row.append(ctl);
      } else if (def.type === "crs") {
        state[def.name] ??= def.default ?? "";
        ctl = h("select", { class: "tt-input", id });
        for (const [val, lab] of CRS_PRESETS) {
          if (val === "UTM" && tool.id !== "project_raster") continue;
          if (val === "" && def.required) continue;
          ctl.append(h("option", { value: val }, esc(lab)));
        }
        ctl.append(h("option", { value: "custom" }, "Other (EPSG code)…"));
        const custom = h("input", { class: "tt-input", type: "text", value: state[def.name], placeholder: "EPSG:32749", "aria-label": `${def.label}, EPSG code` });
        ctl.value = CRS_PRESETS.some(([v]) => v === state[def.name]) ? state[def.name] : "custom";
        custom.hidden = ctl.value !== "custom";
        ctl.addEventListener("change", () => {
          if (ctl.value !== "custom") state[def.name] = ctl.value;
          custom.hidden = ctl.value !== "custom";
          custom.value = state[def.name];
        });
        custom.addEventListener("input", () => (state[def.name] = custom.value.trim()));
        row.append(ctl, custom);
      } else if (def.type === "mapalgebra") {
        const setOut = (name) => {
          if (state.outEdited || !name) return;
          state.out = name;
          const el = form.querySelector('[data-param="out"]');
          if (el) el.value = name;
        };
        ctl = renderCalculator(row, def, state, id, () => renderParams(form, tool, state), setOut);
      } else if (def.type === "bool") {
        state[def.name] ??= def.default ?? false;
        ctl = h("input", { type: "checkbox", id, checked: state[def.name] });
        ctl.addEventListener("change", () => (state[def.name] = ctl.checked));
        const item = h("label", { class: "tt-check tt-bool", for: id });
        item.append(ctl, document.createTextNode(def.label));
        row.append(item);
      } else {
        state[def.name] ??= def.name === "out" ? fillName(def.default, outNames(tool, state)) : def.default ?? "";
        ctl = def.multiline
          ? h("textarea", { class: "tt-input tt-area", id, rows: "4", placeholder: def.placeholder ?? "" })
          : h("input", { class: "tt-input", id, type: "text", inputmode: def.type === "number" ? "decimal" : "text", placeholder: def.placeholder ?? "", "data-param": def.name });
        ctl.value = def.multiline ? String(state[def.name]).replace(/;/g, "\n") : state[def.name];
        ctl.addEventListener("input", () => {
          state[def.name] = ctl.value;
          if (def.name === "out") state.outEdited = true;
        });
        row.append(ctl);
      }
      form.append(row);
    }
  }

  /**
   * ArcMap's Raster Calculator: Layers and variables, the operator keypad, Conditional / Math /
   * Trigonometric functions, and the Map Algebra expression box. Double-click (or Enter) adds a
   * layer or function at the cursor; a single click shows a function's description.
   */
  function renderCalculator(row, def, state, id, rerender, setOut = () => {}) {
    state[def.name] ??= def.default ?? "";
    const wrap = h("div", { class: "tt-calc" });
    const ta = h("textarea", { class: "tt-input tt-area tt-calc-expr", id, rows: "4", spellcheck: "false", placeholder: 'Float("b8" - "b4") / Float("b8" + "b4")' });
    ta.value = state[def.name];
    const status = h("div", { class: "tt-calc-status", role: "status" });
    const help = h("div", { class: "tt-calc-help" }, "Double-click a layer or a function to add it to the expression.");
    const validate = () => {
      state[def.name] = ta.value;
      if (!ta.value.trim()) {
        status.className = "tt-calc-status";
        status.textContent = "";
        return;
      }
      try {
        const { rasters } = translate(ta.value);
        const known = new Set(api.rasterLayers().map((l) => l.name));
        const knownStem = new Set([...known].map((n) => n.replace(/\.[^.]+$/, "")));
        const missing = rasters.filter((n) => !known.has(n) && !knownStem.has(n.replace(/\.[^.]+$/, "")));
        const stemOf = (n) => n.replace(/\.[^.]+$/, "").toLowerCase();
        const all = api.rasterLayers();
        const local = missing.length
          ? []
          : rasters
              .map((n) => all.filter((l) => l.name === n || stemOf(l.name) === stemOf(n)))
              .filter((hits) => hits.length && !hits.some((l) => l.readable !== false))
              .map((hits) => hits[0]);
        if (local.length) {
          status.className = "tt-calc-status is-bad";
          status.innerHTML = `${ICON.err}<span>${esc(local.map((l) => `"${l.name}"`).join(", "))}: GeoLibre does not share local files with plugins. Choose ${local.length > 1 ? "them" : "it"} once:</span>`;
          for (const l of local) {
            const b = h("button", { class: "tt-btn tt-btn-sm", type: "button" }, `${ICON.folder}<span>${esc(l.name)}…</span>`);
            b.addEventListener("click", () => api.pickRasterFile(() => rerender(), l));
            status.append(b);
          }
          return;
        }
        status.className = `tt-calc-status ${missing.length || !rasters.length ? "is-bad" : "is-ok"}`;
        status.innerHTML = missing.length
          ? `${ICON.err}<span>Not on the map: ${esc(missing.map((n) => `"${n}"`).join(", "))}</span>`
          : rasters.length
            ? `${ICON.ok}<span>Valid · uses ${esc(rasters.map((n) => `"${n}"`).join(", "))}</span>`
            : `${ICON.err}<span>Put at least one raster in double quotes</span>`;
      } catch (e) {
        status.className = "tt-calc-status is-bad";
        status.innerHTML = `${ICON.err}<span>${esc(e.message)}</span>`;
      }
    };
    const insert = (text, caretBack = 0) => {
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? start;
      ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
      const pos = start + text.length - caretBack;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      validate();
    };
    ta.addEventListener("input", validate);

    // Layers and variables
    const layersCol = h("div", { class: "tt-calc-col" });
    const layersHead = h("div", { class: "tt-calc-head" }, "<span>Layers and variables</span>");
    const browse = h("button", { class: "tt-btn tt-btn-sm tt-calc-browse", type: "button", title: "Add a raster file from your computer", "aria-label": "Add a raster file" }, `${ICON.folder}<span>Browse…</span>`);
    browse.addEventListener("click", () => api.pickRasterFile(() => rerender()));
    layersHead.append(browse);
    const layersList = h("div", { class: "tt-calc-list", role: "listbox", "aria-label": "Layers and variables" });
    const layers = api.rasterLayers();
    if (!layers.length) layersList.append(h("div", { class: "tt-hint tt-pad" }, "No raster on the map: use the folder."));
    for (const l of layers) {
      const local = l.readable === false;
      const item = h("div", { class: `tt-calc-item${local ? " is-local" : ""}`, role: "option", tabindex: "0", title: local ? `Click to choose the file behind "${l.name}" (GeoLibre does not share local files with plugins)` : `Double-click to add "${l.name}"` }, `${local ? `<span class="tt-pick">${ICON.folder}pick file</span>` : ""}${esc(l.name)}`);
      const add = () => insert(`"${l.name}"`);
      if (local) item.addEventListener("click", () => api.pickRasterFile(() => rerender(), l));
      item.addEventListener("dblclick", add);
      item.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), add()));
      layersList.append(item);
    }
    layersCol.append(layersHead, layersList);

    // Functions, grouped as ArcMap does
    const fnCol = h("div", { class: "tt-calc-col" });
    const fnList = h("div", { class: "tt-calc-list", role: "listbox", "aria-label": "Functions" });
    for (const [group, fns] of Object.entries(FUNCTIONS)) {
      fnList.append(h("div", { class: "tt-calc-group" }, esc(group)));
      for (const [name, desc] of fns) {
        const item = h("div", { class: "tt-calc-item", role: "option", tabindex: "0", title: desc }, esc(name));
        const add = () => insert(`${name}()`, 1);
        item.addEventListener("click", () => {
          for (const x of fnList.querySelectorAll(".is-sel")) x.classList.remove("is-sel");
          item.classList.add("is-sel");
          help.textContent = desc;
        });
        item.addEventListener("dblclick", add);
        item.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), add()));
        fnList.append(item);
      }
    }
    fnCol.append(h("div", { class: "tt-calc-head" }, "<span>Functions</span>"), fnList);

    // keypad: digits and operators, laid out like ArcMap's
    const keys = h("div", { class: "tt-keys", role: "group", "aria-label": "Operators" });
    const KEYS = [
      ["7", "8", "9", "/", "==", "!=", "&"],
      ["4", "5", "6", "*", ">", ">=", "|"],
      ["1", "2", "3", "-", "<", "<=", "^"],
      ["0", ".", "(", ")", "+", "~", "⌫"],
    ];
    const TITLES = { "&": "Boolean And", "|": "Boolean Or", "^": "Boolean XOR", "~": "Boolean Not", "==": "Equal to", "!=": "Not equal to", "⌫": "Clear the expression" };
    for (const rowKeys of KEYS) {
      for (const k of rowKeys) {
        const b = h("button", { class: `tt-key${/\d|\./.test(k) ? "" : " tt-key-op"}`, type: "button", title: TITLES[k] ?? k }, esc(k));
        b.addEventListener("click", () => {
          if (k === "⌫") {
            ta.value = "";
            validate();
            ta.focus();
            return;
          }
          insert(/^[\d.()]$/.test(k) ? k : k === "~" ? "~" : ` ${k} `);
        });
        keys.append(b);
      }
    }

    const top = h("div", { class: "tt-calc-top" });
    top.append(layersCol, fnCol);
    const exprPane = h("div", { class: "tt-calc-pane" });
    exprPane.append(top, keys, help);

    // Expression | Index | Threshold: the last two write the expression for you
    state.calcMode ??= "expression";
    const set = (text) => {
      ta.value = text;
      validate();
    };
    const modes = h("div", { class: "tt-seg", role: "tablist", "aria-label": "Calculator mode" });
    for (const [m, label] of [["expression", "Expression"], ["index", "Index"], ["threshold", "Threshold"]]) {
      const b = h("button", { class: `tt-seg-btn${state.calcMode === m ? " is-active" : ""}`, type: "button", role: "tab", "aria-selected": String(state.calcMode === m) }, label);
      b.addEventListener("click", () => {
        state.calcMode = m;
        rerender();
      });
      modes.append(b);
    }
    const pane =
      state.calcMode === "index"
        ? renderIndexPane(state, layers, set, setOut, rerender)
        : state.calcMode === "threshold"
          ? renderThresholdPane(state, layers, set, setOut)
          : exprPane;
    wrap.append(modes, pane, ta, status);
    row.append(wrap);
    validate();
    return ta;
  }

  /** A raster picker for the Index and Threshold panes (local files are marked). */
  function rasterSelect(layers, value, onChange, label) {
    const sel = h("select", { class: "tt-input", "aria-label": label });
    sel.append(h("option", { value: "" }, ""));
    for (const l of layers) sel.append(h("option", { value: l.name }, esc(l.readable === false ? `${l.name} (pick file)` : l.name)));
    sel.value = value ?? "";
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }
  function field(label, ctl, hint) {
    const f = h("div", { class: "tt-calc-field" });
    f.append(h("label", { class: "tt-label" }, esc(label)), ctl);
    if (hint) f.append(h("div", { class: "tt-hint" }, esc(hint)));
    return f;
  }

  function renderIndexPane(state, layers, set, setOut, rerender) {
    const p = h("div", { class: "tt-calc-pane tt-calc-form" });
    state.calcIndex ??= "ndvi";
    state.calcBands ??= {};
    const ix = INDEXES.find((x) => x.id === state.calcIndex) ?? INDEXES[0];
    const pick = h("select", { class: "tt-input", "aria-label": "Index" });
    for (const x of INDEXES) pick.append(h("option", { value: x.id }, esc(x.name)));
    pick.value = ix.id;
    pick.addEventListener("change", () => {
      state.calcIndex = pick.value;
      rerender();
    });
    p.append(field("Index", pick), h("div", { class: "tt-calc-formula" }, esc(ix.formula)));
    const bands = state.calcBands;
    for (const role of ix.bands) {
      bands[role] ||= guessBand(role, layers);
      const sel = rasterSelect(layers, bands[role], (v) => {
        bands[role] = v;
        build();
      }, `${role} band`);
      p.append(field(`${role} band`, sel, BAND_HINT[role]));
    }
    if (ix.scaled) {
      state.calcScale ??= "1";
      const sc = h("input", { class: "tt-input", type: "text", inputmode: "decimal", value: state.calcScale, "aria-label": "Reflectance scale" });
      sc.addEventListener("input", () => {
        state.calcScale = sc.value.trim();
        build();
      });
      p.append(field("Reflectance scale", sc, "1 when bands are reflectance 0-1; 0.0001 for Sentinel-2 L2A digital numbers (0-10000)."));
    }
    if (ix.L) {
      state.calcL ??= "0.5";
      const L = h("input", { class: "tt-input", type: "text", inputmode: "decimal", value: state.calcL, "aria-label": "Soil factor L" });
      L.addEventListener("input", () => {
        state.calcL = L.value.trim();
        build();
      });
      p.append(field("Soil factor L", L, "0.5 for most land; 0 gives NDVI, 1 for very sparse vegetation."));
    }
    function build() {
      if (ix.bands.some((r) => !bands[r])) return set("");
      const q = (r) => `"${bands[r]}"`;
      set(ix.expr(q, { scale: Number(state.calcScale || 1) || 1, L: Number(state.calcL ?? 0.5) }));
      setOut(ix.id);
    }
    build();
    return p;
  }

  function renderThresholdPane(state, layers, set, setOut) {
    const p = h("div", { class: "tt-calc-pane tt-calc-form" });
    const t = (state.calcThr ??= { raster: layers.find((l) => l.readable !== false)?.name ?? layers[0]?.name ?? "", op: ">", value: "", keep: "both" });
    const op = h("select", { class: "tt-input", "aria-label": "Operator" });
    for (const [o, name] of OPS) op.append(h("option", { value: o }, esc(`${o}  ${name}`)));
    op.value = t.op;
    op.addEventListener("change", () => {
      t.op = op.value;
      build();
    });
    const val = h("input", { class: "tt-input", type: "text", inputmode: "decimal", value: t.value, placeholder: "e.g. 0.4", "aria-label": "Value" });
    val.addEventListener("input", () => {
      t.value = val.value.trim();
      build();
    });
    const line = h("div", { class: "tt-calc-thr" });
    line.append(field("Operator", op), field("Value", val));
    const ras = rasterSelect(layers, t.raster, (v) => {
      t.raster = v;
      build();
    }, "Raster");
    p.append(field("Raster", ras), line);
    const keep = h("div", { class: "tt-calc-keep", role: "radiogroup", "aria-label": "Output" });
    for (const [k, label] of KEEP) {
      const rid = `tt-keep-${k}`;
      const r = h("input", { type: "radio", name: "tt-keep", id: rid, value: k, checked: t.keep === k });
      r.addEventListener("change", () => {
        t.keep = k;
        build();
      });
      const lab = h("label", { class: "tt-check", for: rid });
      lab.append(r, document.createTextNode(label));
      keep.append(lab);
    }
    p.append(field("Output", keep));
    function build() {
      if (!t.raster || t.value === "" || !Number.isFinite(Number(t.value))) return set("");
      const r = `"${t.raster}"`;
      const cond = `${r} ${t.op} ${Number(t.value)}`;
      set(t.keep === "both" ? `Con(${cond}, 1, 0)` : t.keep === "true" ? `Con(${cond}, 1)` : `Con(${cond}, ${r})`);
      const word = OPS.find(([o]) => o === t.op)?.[2] ?? "thr";
      const stem = t.raster.replace(/\.[^.]+$/, "");
      setOut(`${stem}_${word}_${String(t.value).replace("-", "m").replace(".", "_")}`.replace(/[^\w]+/g, "_"));
    }
    build();
    return p;
  }

  function renderFooter(foot, tool, state) {
    foot.innerHTML = "";
    const run = P.run;
    if (run) {
      const status = h("div", { class: `tt-status is-${run.status}` });
      const icon = run.status === "running" ? ICON.clock : run.status === "ok" ? ICON.ok : ICON.err;
      const text = run.status === "running" ? `Running ${tool.name}…` : run.status === "ok" ? `${tool.name} completed.` : `${tool.name} failed.`;
      status.innerHTML = `${icon}<div class="tt-stext"><div>${esc(text)}</div><div class="tt-elapsed">Elapsed Time: <b data-clock>${fmtSec(run.elapsed)}</b> seconds</div></div>`;
      if (run.status === "running") {
        const cancel = h("button", { class: "tt-btn tt-btn-sm", type: "button" }, "Cancel");
        cancel.addEventListener("click", () => api.cancel());
        status.append(cancel);
      }
      foot.append(status);
      if (run.status === "running") foot.append(h("div", { class: "tt-bar" }, "<div></div>"));
      const links = h("div", { class: "tt-links" });
      const det = h("button", { class: "tt-link", type: "button", "aria-expanded": String(P.details) }, P.details ? "Hide Details" : "View Details");
      det.addEventListener("click", () => {
        P.details = !P.details;
        renderFooter(foot, tool, state);
      });
      links.append(det);
      for (const file of run.files ?? []) {
        const sv = h("button", { class: "tt-btn tt-btn-sm", type: "button" }, `${ICON.save}<span>Save ${esc(file.name)}…</span>`);
        sv.addEventListener("click", () => api.saveFile(file, run));
        links.append(sv);
      }
      foot.append(links);
      if (P.details) foot.append(h("pre", { class: "tt-msgs" }, esc(run.messages.join("\n"))));
    }
    const runBtn = h("button", { class: "tt-btn tt-primary tt-run", type: "button", disabled: run?.status === "running" }, `${ICON.run}<span>Run</span>`);
    runBtn.addEventListener("click", () => {
      const missing = tool.params.filter((d) => d.required && (state[d.name] == null || state[d.name] === "" || (Array.isArray(state[d.name]) && !state[d.name].length)));
      for (const el of root.querySelectorAll(".tt-param.is-missing")) el.classList.remove("is-missing");
      if (missing.length) {
        for (const d of missing) root.querySelector(`#tt-${tool.id}-${d.name}`)?.closest(".tt-param")?.classList.add("is-missing");
        root.querySelector(".tt-param.is-missing .tt-input, .tt-param.is-missing input")?.focus();
        return;
      }
      P.details = false;
      P.run = api.execute(tool, { ...state }, {
        onUpdate: (r) => {
          const current = root.querySelector(".tt-foot");
          if (P.view === "tool" && P.tool?.id === tool.id && current) {
            P.run = r;
            const clock = current.querySelector("[data-clock]");
            if (r.status === "running" && clock && current.querySelector(".tt-status.is-running")) clock.textContent = fmtSec(r.elapsed);
            else renderFooter(current, tool, state);
          }
          if (P.view === "home" && P.tab === "history") render();
        },
      });
      renderFooter(foot, tool, state);
    });
    foot.append(h("div", { class: "tt-runrow" }, ""));
    foot.lastChild.append(runBtn);
  }

  render();
  return {
    openTool,
    showTab(tab) {
      P.tab = tab;
      P.view = "home";
      saveUi();
      render();
    },
    refresh: render,
    destroy: () => root.remove(),
  };
}
