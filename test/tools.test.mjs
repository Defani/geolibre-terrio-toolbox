// Runs every Terrio Toolbox tool on real data through the same runner the worker uses.
// Data: RBI 1:25k Kuningan (vector) and DEMNAS Aceh (D:/DEM.tif, raster).
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import * as terrio from "terrio-js";
import { TOOLS } from "../src/tools.js";
import { runTool } from "../src/runner.js";

const require = createRequire(import.meta.url);
await terrio.default({ module_or_path: readFileSync(require.resolve("terrio-js/terrio_bg.wasm")) });

const RBI = "D:/SPATIAL DATA/BUKU_SQL_GEOLIBRE/data/rbi25k_kuningan";
const bboxFilter = (fc, [w, s, e, n]) => ({
  ...fc,
  features: fc.features.filter((f) => {
    const flat = JSON.stringify(f.geometry.coordinates).match(/-?\d+\.\d+/g).map(Number);
    for (let i = 0; i < flat.length; i += 2) if (flat[i] >= w && flat[i] <= e && flat[i + 1] >= s && flat[i + 1] <= n) return true;
    return false;
  }),
});
const AOI = [108.42, -7.0, 108.52, -6.93]; // around Kuningan town
const desa = bboxFilter(JSON.parse(readFileSync(`${RBI}/administrasi_ar_desakel.geojson`, "utf8")), AOI);
const sungai = bboxFilter(JSON.parse(readFileSync(`${RBI}/sungai_ln_25k.geojson`, "utf8")), AOI);
const kontur = JSON.parse(readFileSync("C:/Users/ASUS/AppData/Local/Temp/claude/29abb69cf93759cc/c19f07a6-bdd1-4f7e-84a9-5da6b1ea8b9e/scratchpad/rbi/kontur_kuningan_clip.geojson", "utf8"));
const fc = (name, geojson) => ({ name, geojson });
console.log(`data: ${desa.features.length} desa, ${sungai.features.length} sungai, ${kontur.features.length} kontur`);

// DEM: a 1000x1000 window of DEMNAS, labelled UTM 46N though its coordinates are degrees
const full = terrio.open(readFileSync("D:/DEM.tif"), "dem.tif");
const win = terrio.translate(full, { srcwin: [1000, 1000, 1000, 1000] });
const raw = { filename: "dem_aceh.tif", bytes: win.toBytes("dem.tif", { compress: "DEFLATE" }) };
full.free();
win.free();

const results = {};
let failures = 0;
async function run(id, params, check) {
  const logs = [];
  try {
    const r = runTool(terrio, id, params, (m) => logs.push(m));
    check?.(r);
    results[id] = r;
    const out = r.results
      .map((o) => (o.kind === "vector" ? `${o.count} features` : o.kind === "raster" ? `${o.size.join("x")} ${o.crs}` : `${o.name} ${(o.bytes.length / 1024).toFixed(0)} KB`))
      .join(", ");
    console.log(`ok   ${id.padEnd(20)} ${(r.timing.total / 1000).toFixed(2).padStart(6)} s  ${out}${logs.length ? `  [${logs.join(" | ")}]` : ""}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${id.padEnd(20)} ${e.message}${logs.length ? `  [${logs.join(" | ")}]` : ""}`);
  }
}
const firstRaster = (r) => ({ filename: "in.tif", bytes: r.results[0].bytes });

// --- Define Projection first: the DEM's real CRS is WGS84
await run("define_projection", { raster: raw, crs: "EPSG:4326", out: "dem" }, (r) => assert.match(r.results[0].crs, /WGS 84$/));
const dem = firstRaster(results.define_projection);
const demInfo = terrio.open(new Uint8Array(dem.bytes), "d.tif");
const [w, s, e, n] = demInfo.info(false, false).extent;
demInfo.free();
const cx = (w + e) / 2, cy = (s + n) / 2, dx = (e - w) / 4, dy = (n - s) / 4;
const aoiPoly = fc("aoi", { type: "FeatureCollection", features: [
  { type: "Feature", properties: { zone: 1 }, geometry: { type: "Polygon", coordinates: [[[cx - dx, cy - dy], [cx, cy - dy], [cx, cy + dy], [cx - dx, cy + dy], [cx - dx, cy - dy]]] } },
  { type: "Feature", properties: { zone: 2 }, geometry: { type: "Polygon", coordinates: [[[cx, cy - dy], [cx + dx, cy - dy], [cx + dx, cy + dy], [cx, cy + dy], [cx, cy - dy]]] } },
] });
const observer = fc("obs", { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [cx, cy] } }] });

// --- Analysis
const cig = { type: "FeatureCollection", features: desa.features.filter((f) => f.properties.NAMOBJ === "Cigugur") };
await run("clip", { input: fc("sungai", sungai), clip: fc("cigugur", cig), out: "c" }, (r) => assert.ok(r.results[0].count > 0));
await run("select", { input: fc("desa", desa), where: "NAMOBJ = 'Cigugur'", out: "s" }, (r) => assert.ok(r.results[0].count >= 1));
await run("erase", { input: fc("desa", desa), other: fc("cigugur", cig), out: "e" });
await run("intersection", { input: fc("sungai", sungai), other: fc("desa", desa), out: "i" }, (r) => assert.ok(r.results[0].count > sungai.features.length / 2));
await run("union", { input: fc("desa", desa), other: fc("aoi", { type: "FeatureCollection", features: [{ type: "Feature", properties: { k: 1 }, geometry: { type: "Polygon", coordinates: [[[108.45, -6.98], [108.48, -6.98], [108.48, -6.95], [108.45, -6.95], [108.45, -6.98]]] } }] }), out: "u" });
await run("sym_difference", { input: fc("desa", cig), other: fc("aoi", { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[108.45, -6.98], [108.48, -6.98], [108.48, -6.95], [108.45, -6.95], [108.45, -6.98]]] } }] }), out: "x" });
await run("identity", { input: fc("sungai", sungai), other: fc("desa", desa), out: "id" });
await run("update", { input: fc("desa", desa), other: fc("cigugur", cig), out: "up" });
await run("buffer", { input: fc("sungai", sungai), distance: 50, dissolve: "all", segments: 8, out: "b" }, (r) => assert.equal(r.results[0].count, 1));

// --- Data management
await run("repair", { input: fc("desa", desa), out: "r" });
await run("singlepart", { input: fc("desa", desa), out: "sp" }, (r) => assert.ok(r.results[0].count >= desa.features.length));
await run("convex_hull", { input: fc("desa", desa), out: "h" });
await run("dissolve", { input: fc("desa", desa), fields: [], out: "d" }, (r) => assert.equal(r.results[0].count, 1));
await run("simplify", { input: fc("kontur", kontur), tolerance: 10, out: "sm" });
await run("project_raster", { raster: dem, crs: "UTM", cell: 10, resampling: "bilinear", out: "p" }, (r) => assert.match(r.results[0].crs, /UTM zone 47N/));
const demUtm = firstRaster(results.project_raster);
await run("clip_raster", { raster: dem, clip: aoiPoly, nodata: -9999, out: "cr" });
await run("mosaic", { rasters: [dem, dem], resolution: "highest", out: "m" });
await run("resample", { raster: demUtm, cell: 30, resampling: "average", out: "rs" });
await run("fill_nodata", { raster: firstRaster(results.clip_raster), maxDistance: 10, smoothing: 0, out: "f" });

// --- Spatial Analyst
await run("hillshade", { raster: dem, azimuth: 315, altitude: 45, z: 1, multi: false, out: "hs" });
await run("slope", { raster: demUtm, unit: "degree", z: 1, out: "sl" }, (r) => assert.ok(r.results[0].stats.max > 5 && r.results[0].stats.max <= 90));
await run("aspect", { raster: demUtm, out: "as" });
await run("roughness", { raster: demUtm, index: "TRI", out: "tri" });
await run("contour", { raster: demUtm, interval: 25, base: 0, field: "Contour", out: "ct" }, (r) => assert.ok(r.results[0].count > 10));
await run("viewshed", { raster: dem, observer, oz: 1.7, tz: 0, md: 3000, out: "vs" });
await run("raster_calculator", { expr: { expr: "where(A > 1000, 1, 0)", rasters: { A: demUtm } }, out: "rc" });
await run("focal", { raster: demUtm, size: 5, method: "mean", out: "fo" });
await run("reclassify", { raster: demUtm, mapping: "[0,500)=1\n[500,1000)=2\n[1000,inf)=3\nNO_DATA=NO_DATA", out: "rcl" });
await run("zonal", { zones: aoiPoly, raster: dem, stats: "count,min,max,mean,sum,stdev", out: "z" }, (r) => {
  const props = r.results[0].geojson.features[0].properties;
  assert.ok(Object.keys(props).some((k) => /mean/i.test(k)), JSON.stringify(props));
});
await run("euclidean", { raster: firstRaster(results.reclassify), values: "3", maxdist: "", out: "eu" });

// --- Conversion
await run("raster_to_polygon", { raster: firstRaster(results.reclassify), band: 1, field: "gridcode", conn: "4", out: "rp" });
await run("raster_to_ascii", { raster: demUtm, band: 1, decimals: 2, out: "dem" }, (r) => {
  const head = new TextDecoder().decode(r.results[0].bytes.slice(0, 200));
  assert.match(head, /ncols\s+835/i, head);
  assert.match(head, /cellsize/i);
  assert.equal(r.results[1].name, "dem.prj");
});
await run("raster_to_file", { raster: demUtm, format: "asc", crs: "", out: "dem" }, (r) => assert.ok(r.results[0].bytes.length > 1000));
await run("feature_to_raster", { input: fc("desa", desa), field: "OBJECTID", cell: 30, all: false, out: "fr" });
for (const f of ["gpkg", "shp.zip", "parquet", "fgb", "kml", "kmz", "dxf", "csv"]) {
  const r = runTool(terrio, "feature_to_file", { input: fc("desa", desa), format: f, crs: f === "dxf" ? "EPSG:32749" : "", out: "desa" });
  console.log(`ok   feature_to_file.${f.padEnd(8)} ${(r.timing.total / 1000).toFixed(2).padStart(6)} s  ${(r.results[0].bytes.length / 1024).toFixed(0)} KB`);
}

{
  // AUTO classes: equal intervals over the slope range, classes 1..5 all present
  const logs = [];
  const r = runTool(terrio, "reclassify", { raster: firstRaster(results.slope), mapping: "AUTO 5", out: "auto" }, (m) => logs.push(m));
  const st = r.results[0].stats;
  assert.equal(st.min, 1);
  assert.equal(st.max, 5);
  console.log(`ok   reclassify AUTO 5       ${(r.timing.total / 1000).toFixed(2).padStart(6)} s  classes ${st.min}-${st.max}  [${logs.find((l) => l.startsWith("AUTO"))}]`);
}

const covered = new Set(Object.keys(results).concat("feature_to_file"));
const missing = TOOLS.filter((t) => !covered.has(t.id)).map((t) => t.id);
console.log(`\n${TOOLS.length} tools, ${failures} failed, not exercised: ${missing.join(", ") || "none"}`);
process.exit(failures || missing.length ? 1 : 0);
