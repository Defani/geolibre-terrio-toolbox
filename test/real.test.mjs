// Every Terrio Toolbox tool on the user's real data, as the plugin's worker runs it, with each
// raster output checked by geotiff.js (the reader GeoLibre uses): it must carry a model type
// (GeoLibre's "Unsupported GeoTIFF model type: null") and land where the input is.
//   DEMNAS 1309-12 / 1309-21 (Downloads; shipped without a coordinate system)
//   RBI 1:25k Kuningan villages, rivers, contours
//   Sentinel-2 SEMBILANG B4/B8 full tiles (46592 x 30783 cells each)
// Usage: node --max-old-space-size=8192 test/real.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as terrio from "terrio-js";
import { TOOLS } from "../src/tools.js";
import { runTool } from "../src/runner.js";
import { translate } from "../src/mapalgebra.js";

const require = createRequire(import.meta.url);
await terrio.default({ module_or_path: readFileSync(require.resolve("terrio-js/terrio_bg.wasm")) });
const geotiff = await import("file:///C:/Users/ASUS/GeoLibre/node_modules/geotiff/dist-module/geotiff.js").catch(() => import("file:///C:/Users/ASUS/GeoLibre/node_modules/geotiff/dist-node/geotiff.js"));

const DL = "C:/Users/ASUS/Downloads";
const RBI = "D:/SPATIAL DATA/BUKU_SQL_GEOLIBRE/data/rbi25k_kuningan";
const SEM = `${DL}/SEMBILANG-20261117T095736Z-1-001/SEMBILANG`;
const file = (path) => {
  const b = readFileSync(path);
  return { filename: path.split("/").pop(), bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
};
const inBox = (fc, [w, s, e, n]) => ({
  ...fc,
  features: fc.features.filter((f) => {
    const flat = JSON.stringify(f.geometry.coordinates).match(/-?\d+\.\d+/g).map(Number);
    for (let i = 0; i < flat.length; i += 2) if (flat[i] >= w && flat[i] <= e && flat[i + 1] >= s && flat[i + 1] <= n) return true;
    return false;
  }),
});
const fc = (name, geojson) => ({ name, geojson });
const poly = (w, s, e, n, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });

const DEM = file(`${DL}/DEMNAS_1309-12_v1.0.tif`); // 108.25-108.5 E, 7.0-6.75 S: Kuningan town
const DEM2 = file(`${DL}/DEMNAS_1309-21_v1.0.tif`); // the tile east of it
const AREA = [108.4, -7.0, 108.5, -6.9];
const desa = inBox(JSON.parse(readFileSync(`${RBI}/administrasi_ar_desakel.geojson`, "utf8")), AREA);
const sungai = inBox(JSON.parse(readFileSync(`${RBI}/sungai_ln_25k.geojson`, "utf8")), AREA);
const kontur = inBox(JSON.parse(readFileSync(`${RBI}/kontur_ln_25k.geojson`, "utf8")), [108.45, -6.98, 108.5, -6.95]);
const cig = { type: "FeatureCollection", features: desa.features.filter((f) => f.properties.NAMOBJ === "Cigugur") };
const aoi = { type: "FeatureCollection", features: [poly(108.42, -6.99, 108.46, -6.95, { blok: "A" }), poly(108.46, -6.99, 108.5, -6.95, { blok: "B" })] };
const obs = { type: "FeatureCollection", features: [{ type: "Feature", properties: { nama: "Cigugur" }, geometry: { type: "Point", coordinates: [108.459, -6.966] } }] };
console.log(`data: DEMNAS 2 tiles (no CRS), ${desa.features.length} desa, ${sungai.features.length} sungai, ${kontur.features.length} kontur\n`);

const out = {};
let fails = 0;
const failed = [];
async function check(r, expectBox) {
  for (const o of r.results) {
    if (o.kind !== "raster") continue;
    assert.ok(o.crs, `${o.name}: output has no coordinate system`);
    const tiff = await geotiff.fromArrayBuffer(o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.length));
    const img = await tiff.getImage();
    const keys = img.getGeoKeys();
    assert.ok(keys?.GTModelTypeGeoKey, `${o.name}: no GTModelTypeGeoKey, GeoLibre would fail with "Unsupported GeoTIFF model type: null"`);
    if (expectBox && keys.GTModelTypeGeoKey === 2) {
      const [w, s, e, n] = img.getBoundingBox();
      assert.ok(w < expectBox[2] && e > expectBox[0] && s < expectBox[3] && n > expectBox[1], `${o.name}: bbox ${[w, s, e, n].map((v) => v.toFixed(3))} is not where the input is`);
    }
  }
}
async function run(id, params, { expect, box, label } = {}) {
  const logs = [];
  const t0 = performance.now();
  try {
    const r = runTool(terrio, id, params, (m) => logs.push(m));
    await check(r, box);
    expect?.(r);
    out[label ?? id] = r;
    const desc = r.results.map((o) => (o.kind === "vector" ? `${o.count} features` : o.kind === "raster" ? `${o.size.join("x")} ${o.crs}${o.stats ? ` [${o.stats.min.toFixed(2)}..${o.stats.max.toFixed(2)}]` : ""}` : `${o.name} ${(o.bytes.length / 1024).toFixed(0)} KB`)).join(", ");
    console.log(`ok   ${(label ?? id).padEnd(24)} ${((performance.now() - t0) / 1000).toFixed(2).padStart(6)} s  ${desc}`);
    return r;
  } catch (e) {
    fails++;
    failed.push(label ?? id);
    console.log(`FAIL ${(label ?? id).padEnd(24)} ${((performance.now() - t0) / 1000).toFixed(2).padStart(6)} s  ${e.message}${logs.length ? `  [${logs.slice(-2).join(" | ")}]` : ""}`);
    return null;
  }
}
const ras = (r, name = "in.tif") => ({ filename: name, bytes: r.results[0].bytes.buffer.slice(0) });
const DEMBOX = [108.25, -7.0, 108.5, -6.75];

// ---------------- Spatial Analyst on raw DEMNAS (no CRS)
await run("hillshade", { raster: DEM, azimuth: 315, altitude: 45, z: 1, multi: false, out: "hs" }, { box: DEMBOX });
await run("slope", { raster: DEM, unit: "degree", z: 1, out: "sl" }, { box: DEMBOX, expect: (r) => assert.ok(r.results[0].stats.max < 80 && r.results[0].stats.mean < 30, "slope in degrees should be realistic") });
await run("aspect", { raster: DEM, out: "as" }, { box: DEMBOX });
await run("roughness", { raster: DEM, index: "TRI", out: "tri" }, { box: DEMBOX });
await run("contour", { raster: DEM, interval: 50, base: 0, field: "Contour", out: "ct" }, { expect: (r) => assert.ok(r.results[0].count > 100) });
await run("viewshed", { raster: DEM, observer: fc("obs", obs), oz: 1.7, tz: 0, md: 5000, out: "vs" });
await run("focal", { raster: DEM, size: 5, method: "mean", out: "fo" }, { box: DEMBOX });
await run("reclassify", { raster: DEM, mapping: "AUTO 5", out: "rc" }, { box: DEMBOX, expect: (r) => assert.equal(r.results[0].stats.max, 5) });
await run("zonal", { zones: fc("aoi", aoi), raster: DEM, stats: "count,min,max,mean,sum,stdev", out: "z" }, { expect: (r) => assert.ok(r.results[0].geojson.features[0].properties.z_b1_mean > 0) });
await run("euclidean", { raster: ras(out.reclassify), values: "5", maxdist: "", out: "eu" }, { box: DEMBOX });
for (const [expr, label] of [
  ['Float("dem") / 1000', "calc Float"],
  ['Con("dem" > 1000, 1, 0)', "calc Con"],
  ['SetNull("dem" < 500, "dem")', "calc SetNull"],
  ['RoundDown("dem" / 100) * 100', "calc RoundDown"],
  ['Con(IsNull("dem"), 0, SquareRoot("dem"))', "calc IsNull+Sqrt"],
]) {
  const t = translate(expr);
  await run("raster_calculator", { expr: { expr: t.expr, rasters: { A: DEM } }, out: label }, { box: DEMBOX, label });
}

// ---------------- Data Management on raw DEMNAS
await run("define_projection", { raster: DEM, crs: "EPSG:4326", out: "dp" }, { box: DEMBOX });
await run("project_raster", { raster: DEM, crs: "UTM", cell: 8, resampling: "bilinear", out: "pr" }, { expect: (r) => assert.match(r.results[0].crs, /UTM zone 49S/) });
await run("clip_raster", { raster: DEM, clip: fc("cigugur", cig), nodata: -9999, out: "cr" }, { box: [108.43, -6.99, 108.48, -6.94] });
await run("mosaic", { rasters: [DEM, DEM2], resolution: "highest", out: "mo" }, { box: [108.25, -7.0, 108.75, -6.75], expect: (r) => assert.ok(r.results[0].size[0] > 6000) });
await run("resample", { raster: DEM, cell: 0.0003, resampling: "average", out: "rs" }, { box: DEMBOX });
await run("fill_nodata", { raster: ras(out.clip_raster), maxDistance: 10, smoothing: 0, out: "fn" });

// ---------------- Conversion
await run("raster_to_polygon", { raster: ras(out.reclassify), band: 1, field: "gridcode", conn: "8", out: "rp" }, { expect: (r) => assert.ok(r.results[0].count > 5) });
await run("raster_to_ascii", { raster: DEM, band: 1, decimals: 2, out: "dem" }, { expect: (r) => assert.match(new TextDecoder().decode(r.results[0].bytes.slice(0, 120)), /ncols\s+3333/i) });
await run("raster_to_file", { raster: DEM, format: "cog", crs: "", out: "dem" });
await run("feature_to_raster", { input: fc("desa", desa), field: "OBJECTID", cell: 30, all: false, out: "fr" });
for (const f of ["gpkg", "shp.zip", "parquet", "kml", "dxf"]) await run("feature_to_file", { input: fc("desa", desa), format: f, crs: "", out: "desa" }, { label: `to_file .${f}` });

// ---------------- Analysis and Data Management (vector)
await run("clip", { input: fc("sungai", sungai), clip: fc("cigugur", cig), out: "c" }, { expect: (r) => assert.ok(r.results[0].count > 0) });
await run("select", { input: fc("desa", desa), where: "NAMOBJ = 'Cigugur'", out: "s" }, { expect: (r) => assert.equal(r.results[0].count, 1) });
for (const op of ["erase", "intersection", "union", "sym_difference", "identity", "update"]) await run(op, { input: fc("desa", desa), other: fc("aoi", aoi), out: op });
await run("buffer", { input: fc("sungai", sungai), distance: 25, dissolve: "all", segments: 8, out: "b" });
await run("repair", { input: fc("desa", desa), out: "r" });
await run("singlepart", { input: fc("desa", desa), out: "sp" });
await run("convex_hull", { input: fc("desa", desa), out: "h" });
await run("dissolve", { input: fc("desa", desa), fields: [], out: "d" });
await run("simplify", { input: fc("kontur", kontur), tolerance: 5, out: "sm" });

// ---------------- Sentinel-2 SEMBILANG: full tiles -> Clip (Raster) to an AOI -> NDVI (ArcMap syntax)
const SEMAOI = { type: "FeatureCollection", features: [poly(104.70, -2.05, 104.85, -1.90, { nama: "Sembilang" })] };
const B4 = file(`${SEM}/S2A_B4-0000000000-0000000000.tif`);
const B8 = file(`${SEM}/S2A_B8-0000000000-0000000000.tif`);
const c4 = await run("clip_raster", { raster: B4, clip: fc("aoi", SEMAOI), nodata: 0, out: "B4" }, { box: [104.7, -2.05, 104.85, -1.9], label: "S2 clip B4 (1.4 G cells)" });
const c8 = await run("clip_raster", { raster: B8, clip: fc("aoi", SEMAOI), nodata: 0, out: "B8" }, { box: [104.7, -2.05, 104.85, -1.9], label: "S2 clip B8 (1.4 G cells)" });
if (c4 && c8) {
  const t = translate('Float("B8" - "B4") / Float("B8" + "B4")');
  await run("raster_calculator", { expr: { expr: t.expr, rasters: { A: ras(c8, "B8.tif"), B: ras(c4, "B4.tif") } }, out: "NDVI" }, { label: "S2 NDVI (ArcMap syntax)", expect: (r) => assert.ok(r.results[0].stats.min >= -1 && r.results[0].stats.max <= 1 && r.results[0].stats.max > 0.5, JSON.stringify(r.results[0].stats)) });
}

const covered = new Set(Object.keys(out).map((k) => k.replace(/^to_file .*/, "feature_to_file")));
for (const k of ["calc Float", "calc Con", "calc SetNull", "calc RoundDown", "calc IsNull+Sqrt", "S2 NDVI (ArcMap syntax)"]) if (out[k]) covered.add("raster_calculator");
const missing = TOOLS.map((t) => t.id).filter((id) => !covered.has(id));
console.log(`\n${Object.keys(out).length} runs ok, ${fails} failed${failed.length ? ` (${failed.join(", ")})` : ""}; tools not run: ${missing.join(", ") || "none"}`);
process.exit(fails || missing.length ? 1 : 0);
