// Node smoke test: terrio-js core runs the toolbox's operations on real data.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as t from "terrio-js";

const require = createRequire(import.meta.url);
const wasm = readFileSync(require.resolve("terrio-js/terrio_bg.wasm"));
let t0 = performance.now();
await t.default({ module_or_path: wasm });
const ms = () => `${((performance.now() - t0) / 1000).toFixed(2)} s`;
console.log("init", ms(), "terrio", t.version());

const RBI = "D:/SPATIAL DATA/BUKU_SQL_GEOLIBRE/data/rbi25k_kuningan";
const step = (label, fn) => {
  t0 = performance.now();
  const r = fn();
  console.log(label.padEnd(34), ms());
  return r;
};

const desa = step("open desa geojson", () => t.open(readFileSync(`${RBI}/administrasi_ar_desakel.geojson`), "desa.geojson"));
const sungai = step("open sungai geojson (14 MB)", () => t.open(readFileSync(`${RBI}/sungai_ln_25k.geojson`), "sungai.geojson"));
const kec = desa;
// one village as the clip polygon
const cig = step("sql select Cigugur", () => t.sql(desa, `SELECT * FROM "${desa.layerNames()[0]}" WHERE NAMOBJ = 'Cigugur'`, {}));
const clipped = step("clipVector sungai by Cigugur", () => t.clipVector(sungai, { like: cig }));
console.log("  clipped features:", clipped.toGeoJSON(0).features.length);
const utm = step("reproject sungai clip to UTM 49S", () => t.open(clipped.toBytes("c.fgb", { tSrs: "EPSG:32749" }), "c.fgb"));
const buf = step("buffer 50 m", () => t.buffer(utm, 50, {}));
const diss = step("dissolve buffer", () => t.dissolve(buf, {}));
const back = step("to WGS84 GeoJSON", () => t.open(diss.toBytes("d.fgb", { tSrs: "EPSG:4326" }), "d.fgb").toGeoJSON(0));
console.log("  dissolved features:", back.features.length, back.features[0]?.geometry.type);
const inter = null;


const demBytes = readFileSync("D:/DEM.tif");
const dem0 = step("open DEM (44 MB)", () => t.open(demBytes, "dem.tif"));
console.log("  info:", JSON.stringify(dem0.info(false, false)).slice(0, 200));
const dem4326 = step("translate aSrs EPSG:4326", () => t.translate(dem0, { aSrs: "EPSG:4326" }));
const demUtm = step("warp to UTM 47N 10 m bilinear", () => t.warp(dem4326, { tSrs: "EPSG:32647", tr: [10, 10], resampling: "bilinear" }));
const hs = step("hillshade", () => t.dem(demUtm, "hillshade", {}));
const sl = step("slope (degrees)", () => t.dem(demUtm, "slope", {}));
const ct = step("contour 25 m", () => t.contour(demUtm, { interval: 25, fieldName: "ELEV" }));
console.log("  contour lines:", ct.toGeoJSON(0).features.length);
const tif = step("hillshade to COG bytes", () => hs.toBytes("hs.tif", { format: "COG", compress: "DEFLATE" }));
console.log("  hillshade COG", (tif.length / 1e6).toFixed(1), "MB");
