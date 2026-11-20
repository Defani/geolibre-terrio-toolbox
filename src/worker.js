// Web Worker that runs terrio. Bundled by build.mjs into a string the plugin starts as a
// blob worker, so long operations (a DEM warp takes seconds) never freeze GeoLibre and a
// running tool can be cancelled by terminating the worker.
import init, * as terrio from "terrio-js";
import { runTool } from "./runner.js";

let ready = null;

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === "init") {
      const t0 = performance.now();
      ready = init({ module_or_path: msg.wasm });
      await ready;
      self.postMessage({ id: msg.id, ok: true, version: terrio.version(), ms: performance.now() - t0 });
      return;
    }
    await ready;
    if (msg.type === "run") {
      const log = (text) => self.postMessage({ id: msg.id, log: text });
      const { results, transfer, timing } = runTool(terrio, msg.tool, msg.params, log);
      self.postMessage({ id: msg.id, ok: true, results, timing }, transfer);
    }
  } catch (error) {
    self.postMessage({ id: msg.id, ok: false, error: String(error?.message ?? error) });
  }
};
