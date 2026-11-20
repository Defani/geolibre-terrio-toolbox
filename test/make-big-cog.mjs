// Turn the Sentinel-2 bands (stripped GeoTIFFs) into COGs GeoLibre can add from a URL.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as t from "terrio-js";
const require = createRequire(import.meta.url);
await t.default({ module_or_path: readFileSync(require.resolve("terrio-js/terrio_bg.wasm")) });
const [src, out] = process.argv.slice(2);
for (const b of ["b4", "b8"]) {
  const t0 = performance.now();
  const d = t.open(new Uint8Array(readFileSync(`${src}/${b}.tif`)), `${b}.tif`);
  const bytes = d.toBytes(`${b}.tif`, { format: "COG", compress: "DEFLATE" });
  writeFileSync(`${out}/s2_${b}_cog.tif`, bytes);
  d.free();
  console.log(b, (bytes.length / 1e6).toFixed(0), "MB", ((performance.now() - t0) / 1000).toFixed(1), "s");
}
