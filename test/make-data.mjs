// Test data for the UI test: a DEMNAS COG (CRS fixed to WGS84) and an AOI + observer inside it.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as t from "terrio-js";
const out = process.argv[2];
const require = createRequire(import.meta.url);
await t.default({ module_or_path: readFileSync(require.resolve("terrio-js/terrio_bg.wasm")) });
const dem = t.translate(t.open(readFileSync("D:/DEM.tif"), "dem.tif"), { srcwin: [800, 800, 2000, 2000], aSrs: "EPSG:4326" });
writeFileSync(`${out}/dem_aceh_cog.tif`, dem.toBytes("dem.tif", { format: "COG", compress: "DEFLATE" }));
const [w, s, e, n] = dem.info(false, false).extent;
const cx = (w + e) / 2, cy = (s + n) / 2, d = (e - w) / 5;
const poly = (x0, y0, x1, y1, props) => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } });
writeFileSync(`${out}/aoi_aceh.geojson`, JSON.stringify({ type: "FeatureCollection", features: [poly(cx - d, cy - d, cx, cy + d, { blok: "A" }), poly(cx, cy - d, cx + d, cy + d, { blok: "B" })] }));
writeFileSync(`${out}/pengamat_aceh.geojson`, JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { nama: "Menara" }, geometry: { type: "Point", coordinates: [cx, cy] } }] }));
console.log("extent", [w, s, e, n].map((v) => v.toFixed(4)).join(", "));
