// Large-raster test: full Sentinel-2 tiles (10980 x 10980, 231 MB per band) through the same
// runner the plugin's worker uses. Usage: node test/big.test.mjs
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import * as terrio from "terrio-js";
import { runTool } from "../src/runner.js";

const require = createRequire(import.meta.url);
await terrio.default({ module_or_path: readFileSync(require.resolve("terrio-js/terrio_bg.wasm")) });
const DIR = "D:/SPATIAL DATA/MAGANG PSKL SUMUT/109. Muara Indah";
const file = (name) => {
  const p = `${DIR}/${name}`;
  console.log(`  ${name}: ${(statSync(p).size / 1e6).toFixed(0)} MB`);
  return { filename: name, bytes: readFileSync(p).buffer };
};
const mem = () => `wasm memory ${(terrio.__wasm?.memory?.buffer?.byteLength ?? 0) / 1e6 | 0} MB, node rss ${(process.memoryUsage().rss / 1e6) | 0} MB`;

function run(id, params) {
  const logs = [];
  const t0 = performance.now();
  try {
    const r = runTool(terrio, id, params, (m) => logs.push(m));
    const o = r.results[0];
    const desc = o.kind === "raster" ? `${o.size.join("x")} ${o.crs}, ${o.stats ? `${o.stats.min.toFixed(3)}..${o.stats.max.toFixed(3)}` : ""}, COG ${(o.bytes.length / 1e6).toFixed(0)} MB` : o.kind === "file" ? `${o.name} ${(o.bytes.length / 1e6).toFixed(0)} MB` : `${o.count} features`;
    console.log(`ok   ${id.padEnd(18)} ${((performance.now() - t0) / 1000).toFixed(1).padStart(6)} s  (terrio ${(r.timing.run / 1000).toFixed(1)} s) ${desc}${logs.length ? `  [${logs.join(" | ")}]` : ""}`);
    return r;
  } catch (e) {
    console.log(`FAIL ${id.padEnd(18)} ${((performance.now() - t0) / 1000).toFixed(1).padStart(6)} s  ${e.message}`);
    return null;
  }
}

console.log("inputs:");
const b4 = file("b4.tif");
const b8 = file("b8.tif");
const ndvi = run("raster_calculator", { A: b8, B: b4, C: "", expr: "(A - B) / (A + B)", out: "NDVI" });
const idx = run("raster_calculator", { A: b8, B: b4, C: "", expr: "where((A - B) / (A + B) > 0.4, 1, 0)", out: "vegetasi" });
if (ndvi) run("reclassify", { raster: { filename: "ndvi.tif", bytes: ndvi.results[0].bytes.buffer }, mapping: "AUTO 5", out: "ndvi_kelas" });
run("raster_to_ascii", { raster: b4, band: 1, decimals: "", out: "b4" });
// a large DEM: DEMNAS Aceh warped to 5 m UTM
const dem = terrio.warp(terrio.translate(terrio.open(readFileSync("D:/DEM.tif"), "dem.tif"), { aSrs: "EPSG:4326" }), { tSrs: "EPSG:32647", tr: [5, 5], resampling: "bilinear" });
const demBytes = dem.toBytes("dem.tif", { compress: "DEFLATE" });
console.log(`  DEM 5 m: ${dem.info(false, false).size.join("x")}`);
dem.free();
const D = () => ({ filename: "dem5.tif", bytes: demBytes.slice().buffer });
run("hillshade", { raster: D(), azimuth: 315, altitude: 45, z: 1, multi: false, out: "hs" });
run("slope", { raster: D(), unit: "degree", z: 1, out: "sl" });
run("contour", { raster: D(), interval: 25, base: 0, field: "Contour", out: "ct" });
run("raster_to_ascii", { raster: D(), band: 1, decimals: 2, out: "dem5" });
console.log(mem());
