// Runs one tool on terrio: opens the inputs, calls the tool, turns the outputs into what
// GeoLibre takes (WGS84 GeoJSON, COG bytes, files) and frees every terrio object it made.
// Shared by the worker and the Node tests.
import { TOOLS } from "./tools.js";
import { makeContext } from "./context.js";

/** terrio functions that record every Dataset they return, so a run can free them all. */
function tracked(terrio, made) {
  return new Proxy(terrio, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== "function" || key === "default") return value;
      return (...args) => {
        const out = value(...args);
        if (out && typeof out.free === "function") made.push(out);
        return out;
      };
    },
  });
}

/** Whether a raster's grid lies inside longitude/latitude bounds with sub-degree cells. */
function looksLikeDegrees(info) {
  const e = info.extent;
  const gt = info.geo_transform;
  if (!e || !gt) return false;
  return e[0] >= -180.5 && e[2] <= 180.5 && e[1] >= -90.5 && e[3] <= 90.5 && Math.abs(gt[1]) < 1 && Math.abs(gt[5]) < 1 && !(gt[0] === 0 && gt[3] === 0);
}

/**
 * A raster without a coordinate system (DEMNAS tiles ship like this) is assumed to be WGS 84
 * when its coordinates are plainly degrees. Without it GeoLibre cannot place the result
 * ("Unsupported GeoTIFF model type: null") and slope/hillshade would not know the cells are
 * degrees. Anything else is left as it is.
 */
function withCrs(T, ds, name, log) {
  const info = ds.info(false, false);
  if (info.type !== "raster" || info.crs?.wkt || info.crs?.epsg) return ds;
  if (!looksLikeDegrees(info)) {
    log(`WARNING: ${name} has no coordinate system; GeoLibre may not be able to place it. Use Define Projection.`);
    return ds;
  }
  log(`${name} has no coordinate system: its coordinates are degrees, so WGS 84 (EPSG:4326) is assumed`);
  return T.translate(ds, { aSrs: "EPSG:4326" });
}

export function runTool(terrio, toolId, params, log = () => {}) {
  const tool = TOOLS.find((t) => t.id === toolId);
  if (!tool) throw new Error(`Unknown tool ${toolId}`);
  const made = [];
  const T = tracked(terrio, made);
  const ctx = makeContext(T, log);
  const t0 = performance.now();
  try {
    const p = {};
    for (const def of tool.params) {
      const v = params[def.name];
      if (v == null || v === "" || (Array.isArray(v) && v.length === 0 && def.type !== "field")) {
        if (def.required) throw new Error(`${def.label} is required`);
        p[def.name] = def.type === "field" ? [] : "";
        continue;
      }
      if (def.type === "fc") p[def.name] = T.fromGeoJSON(v.geojson, v.name.replace(/[^\w]+/g, "_") || "layer", "EPSG:4326");
      else if (def.type === "raster") p[def.name] = withCrs(T, T.open(new Uint8Array(v.bytes), v.filename), v.filename, log);
      else if (def.type === "rasters") p[def.name] = v.map((r) => withCrs(T, T.open(new Uint8Array(r.bytes), r.filename), r.filename, log));
      else if (def.type === "mapalgebra") {
        // { expr: terrio expression, rasters: { A: { filename, bytes }, ... } } from the UI
        const inputs = {};
        for (const [k, r] of Object.entries(v.rasters)) inputs[k] = withCrs(T, T.open(new Uint8Array(r.bytes), r.filename), r.filename, log);
        p[def.name] = { expr: v.expr, inputs };
      } else if (def.type === "number") p[def.name] = Number(v);
      else p[def.name] = v;
    }
    const tOpen = performance.now();
    const outputs = tool.run(T, p, ctx);
    const tRun = performance.now();
    const results = [];
    const transfer = [];
    for (const o of outputs) {
      if (o.kind === "vector") {
        const geojson = ctx.toWGS(o.ds);
        results.push({ kind: "vector", name: o.name, geojson, count: geojson.features.length });
      } else if (o.kind === "raster") {
        o.ds = withCrs(T, o.ds, o.name, log);
        const info = o.ds.info(false, false);
        // DEFLATE takes ~4x longer than the processing itself on very large rasters (50 s for a
        // 120-million-cell Sentinel-2 tile): write those uncompressed (13 s).
        const cells = info.size[0] * info.size[1] * (info.band_count ?? 1);
        const compress = cells > 25e6 ? "NONE" : "DEFLATE";
        if (compress === "NONE") log(`Large output (${(cells / 1e6).toFixed(0)} million cells): written uncompressed for speed`);
        const bytes = o.ds.toBytes("out.tif", { format: "COG", compress });
        results.push({ kind: "raster", name: o.name, bytes, size: info.size, crs: info.crs?.name ?? "", stats: ctx.bandRange(o.ds), style: o.style ?? null });
        transfer.push(bytes.buffer);
      } else if (o.kind === "file") {
        results.push({ kind: "file", name: o.name, bytes: o.bytes });
        transfer.push(o.bytes.buffer);
      }
    }
    const tDone = performance.now();
    for (const w of terrio.takeWarnings?.() ?? []) log(`WARNING: ${w}`);
    return { results, transfer, timing: { open: tOpen - t0, run: tRun - tOpen, write: tDone - tRun, total: tDone - t0 } };
  } finally {
    for (const d of made) {
      try {
        d.free();
      } catch {
        /* already freed */
      }
    }
  }
}
