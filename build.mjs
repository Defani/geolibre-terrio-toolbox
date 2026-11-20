// Builds plugin/ (index.js, style.css, plugin.json, terrio_bg.wasm, licenses) and the zip.
// The worker (terrio glue + tools) is bundled on its own and inlined into index.js as a string,
// which the plugin starts as a blob worker; the WebAssembly ships next to it in the bundle.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.version !== manifest.version) throw new Error("package.json version does not match plugin.json");
const main = readFileSync(join(root, "src", "main.js"), "utf8");
if (!main.includes(`const VERSION = "${manifest.version}"`)) throw new Error("VERSION in src/main.js does not match plugin.json");
const terrioPkg = JSON.parse(readFileSync(require.resolve("terrio-js/package.json"), "utf8"));
if (!main.includes(`const TERRIO_VERSION = "${terrioPkg.version}"`)) throw new Error(`TERRIO_VERSION in src/main.js is not ${terrioPkg.version}`);

const worker = await esbuild.build({
  entryPoints: [join(root, "src", "worker.js")],
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2022",
  write: false,
  legalComments: "none",
  logLevel: "error",
  // terrio's default wasm URL (import.meta.url) is never used: the bytes are passed to init
  define: { "import.meta.url": '"about:blank"' },
});
const workerSrc = worker.outputFiles[0].text;

const bundle = await esbuild.build({
  entryPoints: [join(root, "src", "main.js")],
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  write: false,
  legalComments: "none",
  define: { __WORKER_SRC__: JSON.stringify(workerSrc) },
});

const out = join(root, "plugin");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.js"), `/*! Terrio Toolbox ${manifest.version} | MIT | Defani Arman Alfitriansyah | bundles terrio-js ${terrioPkg.version} (MIT AND MPL-2.0 AND Apache-2.0) */\n${bundle.outputFiles[0].text}`);
cpSync(join(root, "src", "style.css"), join(out, "style.css"));
cpSync(join(root, "plugin.json"), join(out, "plugin.json"));
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));
const terrioDir = dirname(require.resolve("terrio-js/package.json"));
cpSync(join(terrioDir, "terrio_bg.wasm"), join(out, "terrio_bg.wasm"));
for (const f of ["LICENSE", "NOTICE", "LICENSE-THIRD-PARTY.md"]) cpSync(join(terrioDir, f), join(out, `terrio-${f}`));

const zip = join(root, `${manifest.id}-${manifest.version}.zip`);
rmSync(zip, { force: true });
execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${out}\\*' -DestinationPath '${zip}' -Force`], { stdio: "inherit" });
const kb = (p) => `${(readFileSync(p).length / 1024).toFixed(0)} KB`;
console.log(`built ${out}: index.js ${kb(join(out, "index.js"))} (worker ${(workerSrc.length / 1024).toFixed(0)} KB), wasm ${kb(join(out, "terrio_bg.wasm"))}; zip ${kb(zip)}`);
