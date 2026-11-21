// ArcMap map algebra translation, checked by running the translated expressions on terrio.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as t from "terrio-js";
import { translate } from "../src/mapalgebra.js";

const require = createRequire(import.meta.url);
await t.default({ module_or_path: readFileSync(require.resolve("terrio-js/terrio_bg.wasm")) });

let pass = 0;
const check = (name, fn) => {
  fn();
  pass++;
  console.log(`ok   ${name}`);
};

// --- text translation
check("quoted rasters become letters in order", () => {
  const r = translate('("b8" - "b4") / ("b8" + "b4")');
  assert.equal(r.expr, "(A - B) / (A + B)");
  assert.deepEqual(r.rasters, ["b8", "b4"]);
});
check("Con with three and two arguments", () => {
  assert.equal(translate('Con("dem" > 1000, 1, 0)').expr, "where(A > 1000, 1, 0)");
  assert.equal(translate('Con("dem" > 1000, "dem")').expr, "where(A > 1000, A, nan)");
});
check("SetNull, Float, Int, Exp10, Mod, RoundUp", () => {
  assert.equal(translate('SetNull("dem" < 0, "dem")').expr, "where(A < 0, nan, A)");
  assert.equal(translate('Float("a") / "b"').expr, "(1.0 * (A)) / B");
  assert.equal(translate('Int("a" / 10)').expr, "trunc(A / 10)");
  assert.equal(translate('Exp10("a")').expr, "(10.0 ** (A))");
  assert.equal(translate('Mod("a", 7)').expr, "fmod(A, 7)");
  assert.equal(translate('RoundUp("a")').expr, "ceil(A)");
});
check("nested functions and case-insensitive names", () => {
  assert.equal(translate('con(isnull("x"), 0, squareroot("x"))').expr, "where((1.0 * isnan(A)), 0, sqrt(A))");
});
check("Pick builds nested where", () => {
  assert.equal(translate('Pick("cls", 10, 20)').expr, "where((A) == 1, 10, where((A) == 2, 20, nan))");
});
check("raster names with spaces and dots", () => {
  const r = translate('"s2 b8.tif" * 0.0001');
  assert.equal(r.expr, "A * 0.0001");
  assert.deepEqual(r.rasters, ["s2 b8.tif"]);
});
check("errors are readable", () => {
  assert.throws(() => translate('Con("a" > 1)'), /Con takes 2 to 3 arguments, got 1/);
  assert.throws(() => translate('"a" + "b'), /closing quote/);
  assert.throws(() => translate('Sin("a"'), /Missing "\)"/);
  assert.throws(() => translate(""), /empty/);
});

// --- run the translations on a real DEM (DEMNAS Aceh 50x50, metres) and compare cell values
const dem = t.translate(t.open(readFileSync("D:/DEM.tif"), "d.tif"), { srcwin: [1500, 1500, 50, 50], aSrs: "EPSG:4326" });
const src = dem.readBand(1);
const run = (arcmap) => {
  const { expr } = translate(arcmap);
  const out = t.calc(expr, { A: dem }, { type: "Float32" });
  const vals = out.readBand(1);
  out.free();
  return vals;
};
const close = (a, b, msg) => assert.ok((Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) < 1e-3 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const median = [...src].sort((a, b) => a - b)[src.length >> 1];
for (const [arcmap, js] of [
  [`Con("dem" > ${median}, 1, 0)`, (v) => (v > median ? 1 : 0)],
  [`Con("dem" > ${median}, "dem")`, (v) => (v > median ? v : NaN)],
  [`SetNull("dem" < ${median}, "dem")`, (v) => (v < median ? NaN : v)],
  ['SquareRoot("dem")', Math.sqrt],
  ['Ln("dem")', Math.log],
  ['Log10("dem")', Math.log10],
  ['Exp10("dem" / 1000)', (v) => 10 ** (v / 1000)],
  ['RoundDown("dem" / 100) * 100', (v) => Math.floor(v / 100) * 100],
  ['Mod(Int("dem"), 7)', (v) => Math.trunc(v) % 7],
  ['Sin("dem") * Cos("dem")', (v) => Math.fround(Math.sin(v) * Math.cos(v))],
  ['Pick(Int("dem" / 1000), 1, 2, 3)', (v) => [NaN, 1, 2, 3][Math.trunc(v / 1000)] ?? NaN],
]) {
  check(`values: ${arcmap}`, () => {
    const got = run(arcmap);
    for (let i = 0; i < src.length; i += 97) close(got[i], js(src[i]), `${arcmap} cell ${i} (dem ${src[i]})`);
  });
}
const nd = t.calc(translate('Con("dem" > 1e9, 1)').expr, { A: dem }, { type: "Float32" });
console.log("NoData of an all-NaN Con result:", JSON.stringify(nd.info(true, false).bands[0]).slice(0, 160));
console.log(`\n${pass} checks passed`);
