// Spectral index templates for the Raster Calculator's Index tab. Each one writes an ordinary
// calculator expression from the rasters the user picks for its bands, so it runs (and is
// validated) exactly like a typed expression.

/** "A" and "B" are quoted raster names; Float keeps integer bands from truncating. */
const nd = (a, b) => `Float(${a} - ${b}) / Float(${a} + ${b})`;
/** A band as reflectance: Float, times the scale factor when bands are digital numbers. */
const refl = (x, scale) => (scale === 1 ? `Float(${x})` : `(${x} * ${scale})`);

export const INDEXES = [
  { id: "ndvi", name: "NDVI · vegetation", formula: "(NIR − Red) / (NIR + Red)", bands: ["NIR", "Red"], expr: (q) => nd(q("NIR"), q("Red")) },
  { id: "gndvi", name: "GNDVI · green vegetation", formula: "(NIR − Green) / (NIR + Green)", bands: ["NIR", "Green"], expr: (q) => nd(q("NIR"), q("Green")) },
  { id: "ndre", name: "NDRE · red edge, canopy chlorophyll", formula: "(NIR − Red edge) / (NIR + Red edge)", bands: ["NIR", "Red edge"], expr: (q) => nd(q("NIR"), q("Red edge")) },
  {
    id: "savi",
    name: "SAVI · vegetation on bright soil",
    formula: "(1 + L) × (NIR − Red) / (NIR + Red + L)",
    bands: ["NIR", "Red"],
    scaled: true,
    L: true,
    expr: (q, { scale, L }) => {
      const n = refl(q("NIR"), scale), r = refl(q("Red"), scale);
      return `(1 + ${L}) * (${n} - ${r}) / (${n} + ${r} + ${L})`;
    },
  },
  {
    id: "evi",
    name: "EVI · enhanced vegetation",
    formula: "2.5 × (NIR − Red) / (NIR + 6 × Red − 7.5 × Blue + 1)",
    bands: ["NIR", "Red", "Blue"],
    scaled: true,
    expr: (q, { scale }) => {
      const n = refl(q("NIR"), scale), r = refl(q("Red"), scale), b = refl(q("Blue"), scale);
      return `2.5 * (${n} - ${r}) / (${n} + 6 * ${r} - 7.5 * ${b} + 1)`;
    },
  },
  { id: "ndwi", name: "NDWI · open water (McFeeters)", formula: "(Green − NIR) / (Green + NIR)", bands: ["Green", "NIR"], expr: (q) => nd(q("Green"), q("NIR")) },
  { id: "mndwi", name: "MNDWI · water, built-up suppressed", formula: "(Green − SWIR1) / (Green + SWIR1)", bands: ["Green", "SWIR1"], expr: (q) => nd(q("Green"), q("SWIR1")) },
  { id: "ndmi", name: "NDMI · vegetation moisture", formula: "(NIR − SWIR1) / (NIR + SWIR1)", bands: ["NIR", "SWIR1"], expr: (q) => nd(q("NIR"), q("SWIR1")) },
  { id: "ndbi", name: "NDBI · built-up", formula: "(SWIR1 − NIR) / (SWIR1 + NIR)", bands: ["SWIR1", "NIR"], expr: (q) => nd(q("SWIR1"), q("NIR")) },
  { id: "nbr", name: "NBR · burned area", formula: "(NIR − SWIR2) / (NIR + SWIR2)", bands: ["NIR", "SWIR2"], expr: (q) => nd(q("NIR"), q("SWIR2")) },
  { id: "nd", name: "Normalized difference · any two bands", formula: "(Band A − Band B) / (Band A + Band B)", bands: ["Band A", "Band B"], expr: (q) => nd(q("Band A"), q("Band B")) },
];

export const BAND_HINT = {
  NIR: "Sentinel-2 B8 · Landsat 8/9 B5",
  Red: "Sentinel-2 B4 · Landsat 8/9 B4",
  Green: "Sentinel-2 B3 · Landsat 8/9 B3",
  Blue: "Sentinel-2 B2 · Landsat 8/9 B2",
  "Red edge": "Sentinel-2 B5 (or B6, B7)",
  SWIR1: "Sentinel-2 B11 · Landsat 8/9 B6",
  SWIR2: "Sentinel-2 B12 · Landsat 8/9 B7",
};

const SENTINEL = { 2: "Blue", 3: "Green", 4: "Red", 5: "Red edge", 8: "NIR", "8A": "NIR", 11: "SWIR1", 12: "SWIR2" };
const LANDSAT = { 2: "Blue", 3: "Green", 4: "Red", 5: "NIR", 6: "SWIR1", 7: "SWIR2" };
const WORDS = [
  [/nir|nearinfra/i, "NIR"],
  [/swir.?1/i, "SWIR1"],
  [/swir.?2/i, "SWIR2"],
  [/red.?edge|rededge|\bre\d?\b/i, "Red edge"],
  [/\bred\b/i, "Red"],
  [/green/i, "Green"],
  [/blue/i, "Blue"],
];

/** The role of a raster from its name: a band number (B4, B08, SR_B5) or a word (nir, red). */
export function bandRole(name) {
  const base = String(name).replace(/\.[^.]+$/, "");
  const word = WORDS.find(([re]) => re.test(base.replace(/[_\-.]/g, " ")));
  if (word) return word[1];
  const m = [...base.matchAll(/(?:^|[^a-z0-9])b0?(\d{1,2}a?)(?=$|[^a-z0-9])/gi)].pop();
  if (!m) return null;
  const band = m[1].toUpperCase();
  const landsat = /LC0?[89]|LE0?7|LT0?5|landsat|SR_B/i.test(base);
  return (landsat ? LANDSAT : SENTINEL)[band] ?? null;
}

/** The first raster whose name says it is this band; empty when none does. */
export function guessBand(role, layers) {
  return layers.find((l) => bandRole(l.name) === role)?.name ?? "";
}
