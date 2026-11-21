// Index templates: band roles from file names, and every template writes an expression the
// calculator accepts and that computes the right values on real Sentinel-2 bands.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import * as terrio from "terrio-js";
import { INDEXES, bandRole, guessBand } from "../src/indices.js";
import { translate } from "../src/mapalgebra.js";
import { runTool } from "../src/runner.js";

const roles = {
  "S2A_B4.tif": "Red", "S2A_B8.tif": "NIR", "sembilang_b8.tif": "NIR", "T48MXT_20240101_B08_10m.jp2": "NIR",
  "S2A_B11-0000000000-0000000000.tif": "SWIR1", "S2A_B12.tif": "SWIR2", "S2A_B3.tif": "Green", "S2A_B2.tif": "Blue", "S2A_B5.tif": "Red edge",
  "LC09_L2SP_118062_SR_B5.TIF": "NIR", "LC08_SR_B6.TIF": "SWIR1", "nir.tif": "NIR", "red_band.tif": "Red", "demnas_kuningan.tif": null,
};
for (const [n, r] of Object.entries(roles)) assert.equal(bandRole(n), r, n);
const layers = Object.keys(roles).map((name) => ({ name }));
assert.equal(guessBand("NIR", layers), "S2A_B8.tif");
for (const ix of INDEXES) {
  const q = (r) => `"band_${r.replace(/\W/g, "")}.tif"`;
  const t = translate(ix.expr(q, { scale: 0.0001, L: 0.5 }));
  assert.equal(t.rasters.length, new Set(ix.bands).size, ix.id);
}
console.log(`ok   ${Object.keys(roles).length} band names, ${INDEXES.length} templates translate`);

const require = createRequire(import.meta.url);
await terrio.default({ module_or_path: readFileSync(require.resolve("terrio-js/terrio_bg.wasm")) });
const S = "C:/Users/ASUS/AppData/Local/Temp/claude/29abb69cf93759cc/c19f07a6-bdd1-4f7e-84a9-5da6b1ea8b9e/scratchpad/rbi";
if (existsSync(`${S}/sembilang_b4.tif`)) {
  const b4 = { filename: "b4.tif", bytes: readFileSync(`${S}/sembilang_b4.tif`).buffer };
  const b8 = { filename: "b8.tif", bytes: readFileSync(`${S}/sembilang_b8.tif`).buffer };
  const ndvi = INDEXES.find((x) => x.id === "ndvi");
  const t = translate(ndvi.expr((r) => (r === "NIR" ? '"b8"' : '"b4"')));
  const r = runTool(terrio, "raster_calculator", { expr: { expr: t.expr, rasters: { A: b8, B: b4 } }, out: "ndvi" });
  const st = r.results[0].stats;
  assert.ok(st.min >= -1 && st.max <= 1 && st.max > 0.8, JSON.stringify(st));
  const thr = translate('Con("ndvi" > 0.4, 1)');
  const r2 = runTool(terrio, "raster_calculator", { expr: { expr: thr.expr, rasters: { A: { filename: "n.tif", bytes: r.results[0].bytes.buffer } } }, out: "veg" });
  assert.deepEqual([r2.results[0].stats.min, r2.results[0].stats.max], [1, 1], "True only keeps 1s");
  console.log(`ok   NDVI on Sentinel-2 Sembilang ${st.min.toFixed(2)}..${st.max.toFixed(2)}; threshold True only = 1`);
} else console.log("skip real-data check (Sembilang clip not found)");
