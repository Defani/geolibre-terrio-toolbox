// Benchmark: terrio-js (Terrio Toolbox) vs the engines GeoLibre uses today, on the same data,
// single-threaded in Node, timing the whole call (read input bytes, process, write output bytes).
//   - whitebox-wasm 0.7.3 (GeoLibre's in-browser WASM tool runner, via runTool)
//   - Turf.js (GeoLibre's client-side Vector tools)
// Median of 3 runs. Usage: node test/bench.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as t from "terrio-js";

const GL = "C:/Users/ASUS/GeoLibre/node_modules";
const require = createRequire(import.meta.url);
await t.default({ module_or_path: readFileSync(require.resolve("terrio-js/terrio_bg.wasm")) });
const wb = await import(`file:///${GL}/whitebox-wasm/tools.mjs`);
await wb.initTools(readFileSync(`${GL}/whitebox-wasm/whitebox-cli.wasm`));
const turf = await import(`file:///${GL}/@turf/turf/dist/esm/index.js`).catch(() => null);

const RBI = "D:/SPATIAL DATA/BUKU_SQL_GEOLIBRE/data/rbi25k_kuningan";

async function median(fn, n = 3) {
  const times = [];
  let out;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    out = await fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { ms: times[Math.floor(n / 2)], out };
}
const rows = [];
async function compare(task, data, terrioFn, otherName, otherFn) {
  const a = await median(terrioFn);
  let b = null;
  try {
    b = otherFn ? await median(otherFn) : null;
  } catch (e) {
    b = { error: e.message.slice(0, 80) };
  }
  const ratio = b?.ms ? b.ms / a.ms : null;
  rows.push({ task, data, terrio: a.ms, other: otherName, otherMs: b?.ms ?? null, ratio, note: b?.error ?? "" });
  console.log(`${task.padEnd(26)} terrio ${(a.ms / 1000).toFixed(2)} s | ${otherName} ${b?.ms ? (b.ms / 1000).toFixed(2) + " s" : b?.error ?? "-"} ${ratio ? `| terrio ${ratio.toFixed(1)}x ${ratio >= 1 ? "faster" : "slower"}` : ""}`);
}

// ---------- rasters: DEMNAS Aceh in UTM 47N, two sizes
const full = t.translate(t.open(readFileSync("D:/DEM.tif"), "dem.tif"), { aSrs: "EPSG:4326" });
const demBig = t.warp(full, { tSrs: "EPSG:32647", tr: [8.3, 8.3], resampling: "bilinear" });
const bigBytes = demBig.toBytes("dem.tif", { compress: "DEFLATE" });
const small = t.translate(demBig, { srcwin: [0, 0, 2000, 2000] });
const smallBytes = small.toBytes("dem.tif", { compress: "DEFLATE" });
const [bw, bh] = demBig.info(false, false).size;
console.log(`DEM ${bw}x${bh} (${(bigBytes.length / 1e6).toFixed(0)} MB) and 2000x2000`);

const wbRun = async (tool, bytes, args) => {
  const r = await wb.runTool(tool, { args: ["--input=/work/dem.tif", ...args], input: { "dem.tif": bytes } });
  if (r.exitCode !== 0) throw new Error(r.stdout.slice(-2).join(" "));
  return r.files;
};
for (const [label, bytes] of [["2000x2000", smallBytes], [`${bw}x${bh}`, bigBytes]]) {
  await compare("Hillshade", label, () => { const d = t.open(bytes, "dem.tif"); const r = t.dem(d, "hillshade", { computeEdges: true }).toBytes("o.tif", {}); d.free(); return r; },
    "whitebox", () => wbRun("hillshade", bytes, ["--output=/work/o.tif"]));
  await compare("Slope (degrees)", label, () => { const d = t.open(bytes, "dem.tif"); const r = t.dem(d, "slope", { computeEdges: true }).toBytes("o.tif", {}); d.free(); return r; },
    "whitebox", () => wbRun("slope", bytes, ["--output=/work/o.tif", "--units=degrees"]));
  await compare("Aspect", label, () => { const d = t.open(bytes, "dem.tif"); const r = t.dem(d, "aspect", { computeEdges: true }).toBytes("o.tif", {}); d.free(); return r; },
    "whitebox", () => wbRun("aspect", bytes, ["--output=/work/o.tif"]));
  await compare("Contour 50 m", label, () => { const d = t.open(bytes, "dem.tif"); const r = t.contour(d, { interval: 50 }).toBytes("o.gpkg", {}); d.free(); return r; },
    "whitebox", () => wbRun("contours_from_raster", bytes, ["--output=/work/o.gpkg", "--interval=50"]));
}

// ---------- vectors: RBI Kuningan
const desaGJ = JSON.parse(readFileSync(`${RBI}/administrasi_ar_desakel.geojson`, "utf8"));
const sungaiGJ = JSON.parse(readFileSync(`${RBI}/sungai_ln_25k.geojson`, "utf8"));
const desaBytes = readFileSync(`${RBI}/administrasi_ar_desakel.geojson`);
console.log(`vectors: ${desaGJ.features.length} villages, ${sungaiGJ.features.length} river lines`);

await compare("Dissolve (all villages)", "751 polygons",
  () => t.dissolve(t.open(desaBytes, "desa.geojson"), {}).toGeoJSON(0),
  "turf.union", turf && (() => turf.union(turf.featureCollection(desaGJ.features.map((f) => turf.feature(f.geometry))))));
await compare("Buffer 50 m (rivers)", "10162 lines",
  () => { const u = t.open(t.open(readFileSync(`${RBI}/sungai_ln_25k.geojson`), "s.geojson").toBytes("u.fgb", { tSrs: "EPSG:32749" }), "u.fgb"); return t.buffer(u, 50, { quadrantSegments: 8 }).toBytes("o.fgb", {}); },
  "turf.buffer", turf && (() => sungaiGJ.features.map((f) => turf.buffer(f, 0.05, { units: "kilometers", steps: 8 }))));
await compare("Clip rivers by villages", "10162 x 751",
  () => t.layerAlgebra(t.open(readFileSync(`${RBI}/sungai_ln_25k.geojson`), "s.geojson"), t.open(desaBytes, "desa.geojson"), "clip", {}).toGeoJSON(0),
  "whitebox clip", async () => {
    const r = await wb.runTool("clip", { args: ["--input=/work/s.geojson", "--overlay=/work/d.geojson", "--output=/work/o.geojson"], input: { "s.geojson": readFileSync(`${RBI}/sungai_ln_25k.geojson`), "d.geojson": desaBytes } });
    if (r.exitCode !== 0) throw new Error(r.stdout.slice(-2).join(" "));
    return r.files;
  });

writeFileSync(new URL("./bench-results.json", import.meta.url), JSON.stringify({ when: new Date().toISOString(), node: process.version, terrio: t.version(), rows }, null, 2));
console.log("saved test/bench-results.json");
