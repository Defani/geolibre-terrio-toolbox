// Tool definitions for Terrio Toolbox, shared by the UI (parameters, help) and the
// worker (run). Toolboxes and toolsets follow ArcMap's ArcToolbox where a tool exists there.
//
// Parameter types:
//   fc      feature layer (GeoLibre vector layer, sent as WGS84 GeoJSON); `geom` filters the list
//   raster  raster layer (GeoLibre COG layer, sent as file bytes) or a file picked with Browse
//   rasters several rasters
//   field   attribute of the fc parameter named in `of` (`multi` for several)
//   number, text, bool, enum (`options`), crs (EPSG code)
// run(T, p, ctx) returns outputs: { kind: "vector"|"raster"|"file"|"table", name, ds | bytes | rows }.

export const TOOLBOXES = [
  { id: "analysis", name: "Analysis Tools", sets: ["Extract", "Overlay", "Proximity"] },
  { id: "conversion", name: "Conversion Tools", sets: ["From Raster", "To Raster", "To File"] },
  {
    id: "management",
    name: "Data Management Tools",
    sets: ["Features", "Generalization", "Projections and Transformations", "Raster"],
  },
  { id: "spatial", name: "Spatial Analyst Tools", sets: ["Surface", "Map Algebra", "Neighborhood", "Reclass", "Zonal", "Distance"] },
];

const OUT = (def) => ({ name: "out", label: "Output layer name", type: "text", required: true, default: def });

const VECTOR_FORMATS = [
  ["GeoPackage (.gpkg)", "gpkg"],
  ["Shapefile (.shp.zip)", "shp.zip"],
  ["GeoParquet (.parquet)", "parquet"],
  ["FlatGeobuf (.fgb)", "fgb"],
  ["GeoJSON (.geojson)", "geojson"],
  ["KML (.kml)", "kml"],
  ["KMZ (.kmz)", "kmz"],
  ["AutoCAD DXF (.dxf)", "dxf"],
  ["CSV with WKT (.csv)", "csv"],
  ["GPX (.gpx)", "gpx"],
  ["GML (.gml)", "gml"],
];
const RASTER_FORMATS = [
  ["Cloud Optimized GeoTIFF (.tif)", "cog"],
  ["GeoTIFF (.tif)", "tif"],
  ["Esri ASCII grid (.asc)", "asc"],
  ["ERDAS Imagine (.img)", "img"],
  ["ENVI (.envi)", "envi"],
  ["PNG with world file (.png)", "png"],
];
const RESAMPLING = ["near", "bilinear", "cubic", "cubicspline", "lanczos", "average", "mode", "min", "max", "med"];
const OVERLAY = (op, name, help, def) => ({
  id: op.replace("-", "_"),
  name,
  box: "analysis",
  set: "Overlay",
  help,
  params: [
    { name: "input", label: "Input Features", type: "fc", required: true },
    { name: "other", label: op === "erase" || op === "clip" ? "Erase Features" : "Overlay Features", type: "fc", required: true },
    OUT(def),
  ],
  run(T, p) {
    return [{ kind: "vector", name: p.out, ds: T.layerAlgebra(p.input, p.other, op, {}) }];
  },
});

/** Layer name terrio gave a dataset, quoted for SQL. */
const lyr = (ds) => `"${ds.layerNames()[0].replace(/"/g, '""')}"`;

export const TOOLS = [
  // ---------------- Analysis Tools ----------------
  {
    id: "clip",
    name: "Clip",
    box: "analysis",
    set: "Extract",
    help: "Extracts the input features that overlay the clip features. Attributes of the input are kept; features are cut at the clip polygons' edges.",
    params: [
      { name: "input", label: "Input Features", type: "fc", required: true, help: "The features to be clipped." },
      { name: "clip", label: "Clip Features", type: "fc", geom: "polygon", required: true, help: "Polygons used to clip the input features." },
      OUT("{input}_Clip"),
    ],
    run(T, p) {
      return [{ kind: "vector", name: p.out, ds: T.layerAlgebra(p.input, p.clip, "clip", {}) }];
    },
  },
  {
    id: "select",
    name: "Select",
    box: "analysis",
    set: "Extract",
    help: "Extracts features that match an SQL expression into a new layer.",
    params: [
      { name: "input", label: "Input Features", type: "fc", required: true },
      { name: "where", label: "Expression (WHERE)", type: "text", required: true, default: "", placeholder: "NAMOBJ = 'Cigugur'", help: "An OGR SQL WHERE clause, e.g. NAMOBJ = 'Cigugur' or VALKNT >= 500." },
      OUT("{input}_Select"),
    ],
    run(T, p) {
      return [{ kind: "vector", name: p.out, ds: T.sql(p.input, `SELECT * FROM ${lyr(p.input)} WHERE ${p.where}`) }];
    },
  },
  OVERLAY("erase", "Erase", "Removes the parts of the input features that overlap the erase features.", "{input}_Erase"),
  OVERLAY("intersection", "Intersect", "Computes the geometric intersection of the input and overlay features. Output features carry the attributes of both.", "{input}_Intersect"),
  OVERLAY("union", "Union", "Computes the geometric union of two polygon layers. All features and their attributes are written to the output.", "{input}_Union"),
  OVERLAY("sym-difference", "Symmetrical Difference", "Keeps the parts of the input and overlay features that do not overlap.", "{input}_SymDiff"),
  OVERLAY("identity", "Identity", "Keeps all input features and splits them where the identity features overlap, adding their attributes.", "{input}_Identity"),
  OVERLAY("update", "Update", "Replaces the input features where the update features overlap them.", "{input}_Update"),
  {
    id: "buffer",
    name: "Buffer",
    box: "analysis",
    set: "Proximity",
    help: "Creates buffer polygons around input features at a distance in meters. The data is projected to its UTM zone for the buffer and back to WGS84 for the map.",
    params: [
      { name: "input", label: "Input Features", type: "fc", required: true },
      { name: "distance", label: "Distance (meters)", type: "number", required: true, default: 100, min: 0 },
      { name: "dissolve", label: "Dissolve Type", type: "enum", options: [["NONE", "none"], ["ALL", "all"]], default: "none", help: "ALL merges overlapping buffers into one feature." },
      { name: "segments", label: "Segments per quarter circle", type: "number", default: 30, min: 1, max: 90 },
      OUT("{input}_Buffer"),
    ],
    run(T, p, ctx) {
      // ArcGIS repairs geometry before buffering; RBI data has self-intersecting rings.
      const utm = T.makeValid(ctx.toUTM(p.input));
      // Buffers of sharply bending lines can come back self-intersecting: repair them too.
      let out = T.makeValid(T.buffer(utm, p.distance, { quadrantSegments: Math.round(p.segments) }));
      if (p.dissolve === "all") out = T.dissolve(out, {});
      return [{ kind: "vector", name: p.out, ds: out }];
    },
  },

  // ---------------- Conversion Tools ----------------
  {
    id: "raster_to_polygon",
    name: "Raster to Polygon",
    box: "conversion",
    set: "From Raster",
    help: "Converts a raster band to polygons of connected cells with the same value.",
    params: [
      { name: "raster", label: "Input raster", type: "raster", required: true },
      { name: "band", label: "Band", type: "number", default: 1, min: 1 },
      { name: "field", label: "Field", type: "text", default: "gridcode" },
      { name: "conn", label: "Connectedness", type: "enum", options: [["4 (rook)", "4"], ["8 (queen)", "8"]], default: "4" },
      OUT("{raster}_Polygon"),
    ],
    run(T, p) {
      return [{ kind: "vector", name: p.out, ds: T.polygonize(p.raster, { band: p.band, field: p.field, connectedness: Number(p.conn) }) }];
    },
  },
  {
    id: "raster_to_ascii",
    name: "Raster To ASCII",
    box: "conversion",
    set: "From Raster",
    help: "Writes a raster band to an Esri ASCII grid (.asc): a header (ncols, nrows, xllcorner, yllcorner, cellsize, NODATA_value) followed by the cell values row by row. A .prj with the coordinate system is saved next to it.",
    params: [
      { name: "raster", label: "Input raster", type: "raster", required: true },
      { name: "band", label: "Band", type: "number", default: 1, min: 1 },
      { name: "decimals", label: "Decimal places (empty = as stored)", type: "number", default: "" },
      { name: "out", label: "Output ASCII raster file", type: "text", required: true, default: "{raster}" },
    ],
    run(T, p, ctx) {
      let src = p.raster;
      const band = Math.max(1, Math.round(Number(p.band) || 1));
      if (src.info(false, false).band_count > 1 || band !== 1) src = T.translate(src, { bands: [band] });
      const opts = p.decimals !== "" ? { creationOptions: { DECIMAL_PRECISION: String(Math.max(0, Math.round(p.decimals))) } } : {};
      const bytes = src.toBytes(`${p.out.replace(/[^\w.-]+/g, "_")}.asc`, opts);
      const outputs = [{ kind: "file", name: `${p.out}.asc`, bytes }];
      const wkt = src.info(false, false).crs?.wkt;
      if (wkt) outputs.push({ kind: "file", name: `${p.out}.prj`, bytes: new TextEncoder().encode(wkt) });
      ctx.log(`ASCII grid: ${(bytes.length / 1e6).toFixed(1)} MB`);
      return outputs;
    },
  },
  {
    id: "raster_to_file",
    name: "Raster To Other Format",
    box: "conversion",
    set: "From Raster",
    help: "Saves a raster to a file in another format, optionally reprojected.",
    params: [
      { name: "raster", label: "Input raster", type: "raster", required: true },
      { name: "format", label: "Output format", type: "enum", options: RASTER_FORMATS, default: "cog" },
      { name: "crs", label: "Output coordinate system", type: "crs", default: "" },
      { name: "out", label: "Output file name", type: "text", required: true, default: "{raster}" },
    ],
    run(T, p, ctx) {
      const ext = p.format === "cog" ? "tif" : p.format;
      const opts = { ...(p.format === "cog" ? { format: "COG", compress: "DEFLATE" } : {}), ...(p.crs ? { tSrs: p.crs } : {}) };
      return [{ kind: "file", name: `${p.out}.${ext}`, bytes: p.raster.toBytes(`out.${ext}`, opts) }];
    },
  },
  {
    id: "feature_to_raster",
    name: "Feature to Raster",
    box: "conversion",
    set: "To Raster",
    help: "Burns features into a raster from a numeric field. The cell size is in meters: the features are projected to their UTM zone first.",
    params: [
      { name: "input", label: "Input features", type: "fc", required: true },
      { name: "field", label: "Field", type: "field", of: "input", numeric: true, required: true },
      { name: "cell", label: "Output cell size (meters)", type: "number", required: true, default: 30, min: 0.01 },
      { name: "all", label: "All touched cells", type: "bool", default: false },
      OUT("{input}_Raster"),
    ],
    run(T, p, ctx) {
      const utm = ctx.toUTM(p.input);
      const r = T.rasterize(utm, { attribute: p.field, tr: [p.cell, p.cell], ot: "Float32", nodata: -9999, allTouched: !!p.all });
      return [{ kind: "raster", name: p.out, ds: r }];
    },
  },
  {
    id: "feature_to_file",
    name: "Feature Class To File",
    box: "conversion",
    set: "To File",
    help: "Saves a feature layer to a file: GeoPackage, Shapefile, GeoParquet, FlatGeobuf, KML/KMZ, DXF, CSV and more, optionally reprojected.",
    params: [
      { name: "input", label: "Input Features", type: "fc", required: true },
      { name: "format", label: "Output format", type: "enum", options: VECTOR_FORMATS, default: "gpkg" },
      { name: "crs", label: "Output coordinate system", type: "crs", default: "" },
      { name: "out", label: "Output file name", type: "text", required: true, default: "{input}" },
    ],
    run(T, p, ctx) {
      const opts = p.crs ? { tSrs: p.crs } : {};
      let src = p.input;
      if (p.format === "shp.zip") {
        // DBF cannot store empty or space-padded text: trim it and write empty text as NULL.
        const gj = src.toGeoJSON(0);
        let fixed = 0;
        for (const f of gj.features) {
          for (const [k, v] of Object.entries(f.properties ?? {})) {
            if (typeof v !== "string") continue;
            const t = v.replace(/\0/g, "").trim();
            if (t !== v || t === "") {
              f.properties[k] = t === "" ? null : t;
              fixed++;
            }
          }
        }
        if (fixed) ctx.log(`Trimmed ${fixed} text values for the DBF (empty text written as NULL)`);
        src = T.fromGeoJSON(gj, src.layerNames()[0], "EPSG:4326");
      }
      return [{ kind: "file", name: `${p.out}.${p.format}`, bytes: src.toBytes(`${p.out.replace(/[^\w.-]+/g, "_")}.${p.format}`, opts) }];
    },
  },

  // ---------------- Data Management Tools ----------------
  {
    id: "repair",
    name: "Repair Geometry",
    box: "management",
    set: "Features",
    help: "Repairs invalid geometries (self-intersections, bad rings), keeping attributes.",
    params: [{ name: "input", label: "Input Features", type: "fc", required: true }, OUT("{input}_Repaired")],
    run(T, p) {
      return [{ kind: "vector", name: p.out, ds: T.makeValid(p.input) }];
    },
  },
  {
    id: "singlepart",
    name: "Multipart To Singlepart",
    box: "management",
    set: "Features",
    help: "Splits multipart features into one feature per part.",
    params: [{ name: "input", label: "Input Features", type: "fc", required: true }, OUT("{input}_Singlepart")],
    run(T, p) {
      return [{ kind: "vector", name: p.out, ds: T.singlepart(p.input) }];
    },
  },
  {
    id: "convex_hull",
    name: "Minimum Bounding Geometry",
    box: "management",
    set: "Features",
    help: "The convex hull of each feature.",
    params: [{ name: "input", label: "Input Features", type: "fc", required: true }, OUT("{input}_Hull")],
    run(T, p) {
      return [{ kind: "vector", name: p.out, ds: T.convexHull(p.input) }];
    },
  },
  {
    id: "dissolve",
    name: "Dissolve",
    box: "management",
    set: "Generalization",
    help: "Merges features that share the values of the dissolve fields. With no field, all features merge into one.",
    params: [
      { name: "input", label: "Input Features", type: "fc", required: true },
      { name: "fields", label: "Dissolve Field(s)", type: "field", of: "input", multi: true },
      OUT("{input}_Dissolve"),
    ],
    run(T, p) {
      return [{ kind: "vector", name: p.out, ds: T.dissolve(p.input, p.fields?.length ? { fields: p.fields } : {}) }];
    },
  },
  {
    id: "simplify",
    name: "Simplify",
    box: "management",
    set: "Generalization",
    help: "Topology-preserving simplification of lines and polygons. The tolerance is in meters.",
    params: [
      { name: "input", label: "Input Features", type: "fc", required: true },
      { name: "tolerance", label: "Tolerance (meters)", type: "number", required: true, default: 10, min: 0 },
      OUT("{input}_Simplify"),
    ],
    run(T, p, ctx) {
      return [{ kind: "vector", name: p.out, ds: T.simplify(ctx.toUTM(p.input), p.tolerance) }];
    },
  },
  {
    id: "define_projection",
    name: "Define Projection",
    box: "management",
    set: "Projections and Transformations",
    help: "Sets the coordinate system a raster's coordinates are in, without moving any cell. Use it when a raster is labelled with the wrong coordinate system (e.g. degrees labelled as UTM).",
    params: [
      { name: "raster", label: "Input raster", type: "raster", required: true },
      { name: "crs", label: "Coordinate System", type: "crs", required: true, default: "EPSG:4326" },
      OUT("{raster}_Defined"),
    ],
    run(T, p) {
      return [{ kind: "raster", name: p.out, ds: T.translate(p.raster, { aSrs: p.crs }) }];
    },
  },
  {
    id: "project_raster",
    name: "Project Raster",
    box: "management",
    set: "Projections and Transformations",
    help: "Reprojects a raster to another coordinate system. Leave the cell size empty to keep the resolution.",
    params: [
      { name: "raster", label: "Input raster", type: "raster", required: true },
      { name: "crs", label: "Output coordinate system", type: "crs", required: true, default: "UTM" },
      { name: "cell", label: "Output cell size", type: "number", default: "", help: "In the output coordinate system's units (meters for UTM)." },
      { name: "resampling", label: "Resampling technique", type: "enum", options: RESAMPLING.map((r) => [r, r]), default: "bilinear" },
      OUT("{raster}_Project"),
    ],
    run(T, p, ctx) {
      const crs = p.crs === "UTM" ? ctx.utmOfRaster(p.raster) : p.crs;
      const opts = { tSrs: crs, resampling: p.resampling };
      if (p.cell) opts.tr = [p.cell, p.cell];
      ctx.log(`Output coordinate system: ${crs}`);
      return [{ kind: "raster", name: p.out, ds: T.warp(p.raster, opts) }];
    },
  },
  {
    id: "clip_raster",
    name: "Clip (Raster)",
    box: "management",
    set: "Raster",
    help: "Cuts a raster to the shape of polygon features. Cells outside the polygons become NoData and the extent shrinks to the polygons.",
    params: [
      { name: "raster", label: "Input Raster", type: "raster", required: true },
      { name: "clip", label: "Output Extent (polygons)", type: "fc", geom: "polygon", required: true },
      { name: "nodata", label: "NoData Value", type: "number", default: -9999 },
      OUT("{raster}_Clip"),
    ],
    run(T, p, ctx) {
      // Read only the polygons' window first (a lazy, block-by-block read), then cut to their
      // shape: warping a whole 46592 x 30783 Sentinel-2 tile at once does not fit in memory.
      const e = p.clip.info(false, false).layers[0].extent;
      const win = T.translate(p.raster, { projwin: [e[0], e[3], e[2], e[1]], projwinSrs: "EPSG:4326" });
      const [ww, wh] = win.info(false, false).size;
      ctx.log(`Read a ${ww} x ${wh} window around the clip features`);
      return [{ kind: "raster", name: p.out, ds: T.warp(win, { cutline: p.clip, cropToCutline: true, dstNodata: p.nodata }) }];
    },
  },
  {
    id: "mosaic",
    name: "Mosaic To New Raster",
    box: "management",
    set: "Raster",
    help: "Merges several rasters into one new raster.",
    params: [
      { name: "rasters", label: "Input Rasters", type: "rasters", required: true },
      { name: "resolution", label: "Cell size from", type: "enum", options: [["highest", "highest"], ["lowest", "lowest"], ["average", "average"]], default: "highest" },
      OUT("Mosaic"),
    ],
    run(T, p) {
      return [{ kind: "raster", name: p.out, ds: T.mosaic(p.rasters, { resolution: p.resolution }) }];
    },
  },
  {
    id: "resample",
    name: "Resample",
    box: "management",
    set: "Raster",
    help: "Changes a raster's cell size, in the raster's own units.",
    params: [
      { name: "raster", label: "Input Raster", type: "raster", required: true },
      { name: "cell", label: "Output Cell Size", type: "number", required: true, default: 30 },
      { name: "resampling", label: "Resampling Technique", type: "enum", options: RESAMPLING.map((r) => [r, r]), default: "bilinear" },
      OUT("{raster}_Resample"),
    ],
    run(T, p) {
      return [{ kind: "raster", name: p.out, ds: T.warp(p.raster, { tr: [p.cell, p.cell], resampling: p.resampling }) }];
    },
  },
  {
    id: "fill_nodata",
    name: "Fill NoData",
    box: "management",
    set: "Raster",
    help: "Fills NoData holes by interpolating from the cells around them (GDAL's four-direction inverse distance).",
    params: [
      { name: "raster", label: "Input Raster", type: "raster", required: true },
      { name: "maxDistance", label: "Maximum distance (cells)", type: "number", default: 100, min: 0 },
      { name: "smoothing", label: "Smoothing iterations", type: "number", default: 0, min: 0 },
      OUT("{raster}_Filled"),
    ],
    run(T, p) {
      return [{ kind: "raster", name: p.out, ds: T.fillNodata(p.raster, { maxDistance: p.maxDistance, smoothingIterations: p.smoothing }) }];
    },
  },

  // ---------------- Spatial Analyst Tools ----------------
  {
    id: "hillshade",
    name: "Hillshade",
    box: "spatial",
    set: "Surface",
    help: "Shaded relief from a DEM. A DEM in degrees is scaled from degrees to meters automatically.",
    params: [
      { name: "raster", label: "Input raster", type: "raster", required: true },
      { name: "azimuth", label: "Azimuth", type: "number", default: 315, min: 0, max: 360 },
      { name: "altitude", label: "Altitude", type: "number", default: 45, min: 0, max: 90 },
      { name: "z", label: "Z factor", type: "number", default: 1 },
      { name: "multi", label: "Multidirectional", type: "bool", default: false },
      OUT("{raster}_Hillshade"),
    ],
    run(T, p, ctx) {
      const o = { azimuth: p.azimuth, altitude: p.altitude, z: p.z, computeEdges: true, ...ctx.demScale(p.raster) };
      if (p.multi) { o.multidirectional = true; delete o.azimuth; }
      return [{ kind: "raster", name: p.out, ds: T.dem(p.raster, "hillshade", o), style: { colormap: "gray", rescaleMin: 0, rescaleMax: 255 } }];
    },
  },
  {
    id: "slope",
    name: "Slope",
    box: "spatial",
    set: "Surface",
    help: "The steepness of each cell, in degrees or percent rise.",
    params: [
      { name: "raster", label: "Input raster", type: "raster", required: true },
      { name: "unit", label: "Output measurement", type: "enum", options: [["DEGREE", "degree"], ["PERCENT_RISE", "percent"]], default: "degree" },
      { name: "z", label: "Z factor", type: "number", default: 1 },
      OUT("{raster}_Slope"),
    ],
    run(T, p, ctx) {
      const o = { z: p.z, computeEdges: true, percent: p.unit === "percent", ...ctx.demScale(p.raster) };
      return [{ kind: "raster", name: p.out, ds: T.dem(p.raster, "slope", o), style: { colormap: "reds", rescaleMin: 0, rescaleMax: p.unit === "percent" ? 100 : 45 } }];
    },
  },
  {
    id: "aspect",
    name: "Aspect",
    box: "spatial",
    set: "Surface",
    help: "The compass direction each slope faces, 0-360 degrees clockwise from north; flat cells get -9999.",
    params: [{ name: "raster", label: "Input raster", type: "raster", required: true }, OUT("{raster}_Aspect")],
    run(T, p, ctx) {
      return [{ kind: "raster", name: p.out, ds: T.dem(p.raster, "aspect", { computeEdges: true, ...ctx.demScale(p.raster) }), style: { colormap: "hsv", rescaleMin: 0, rescaleMax: 360 } }];
    },
  },
  {
    id: "roughness",
    name: "Terrain Ruggedness",
    box: "spatial",
    set: "Surface",
    help: "Terrain Ruggedness Index (TRI), Topographic Position Index (TPI) or roughness of each cell.",
    params: [
      { name: "raster", label: "Input raster", type: "raster", required: true },
      { name: "index", label: "Index", type: "enum", options: [["TRI", "TRI"], ["TPI", "TPI"], ["Roughness", "roughness"]], default: "TRI" },
      OUT("{raster}_{index}"),
    ],
    run(T, p) {
      return [{ kind: "raster", name: p.out, ds: T.dem(p.raster, p.index, { computeEdges: true }), style: { colormap: "viridis" } }];
    },
  },
  {
    id: "contour",
    name: "Contour",
    box: "spatial",
    set: "Surface",
    help: "Creates contour lines from a DEM at a fixed interval.",
    params: [
      { name: "raster", label: "Input raster", type: "raster", required: true },
      { name: "interval", label: "Contour interval", type: "number", required: true, default: 25, min: 0.001 },
      { name: "base", label: "Base contour", type: "number", default: 0 },
      { name: "field", label: "Elevation field", type: "text", default: "Contour" },
      OUT("{raster}_Contour"),
    ],
    run(T, p) {
      return [{ kind: "vector", name: p.out, ds: T.contour(p.raster, { interval: p.interval, offset: p.base, fieldName: p.field }) }];
    },
  },
  {
    id: "viewshed",
    name: "Viewshed",
    box: "spatial",
    set: "Surface",
    help: "Cells visible from an observer point (the first point of the observer layer). A DEM in degrees is projected to its UTM zone first.",
    params: [
      { name: "raster", label: "Input raster", type: "raster", required: true },
      { name: "observer", label: "Observer point features", type: "fc", geom: "point", required: true },
      { name: "oz", label: "Observer offset (m)", type: "number", default: 1.7 },
      { name: "tz", label: "Target offset (m)", type: "number", default: 0 },
      { name: "md", label: "Maximum distance (m, 0 = unlimited)", type: "number", default: 0, min: 0 },
      OUT("{raster}_Viewshed"),
    ],
    run(T, p, ctx) {
      let src = p.raster;
      if (p.md > 0) {
        // Only the cells within the maximum distance matter: read that window (faster, and
        // a warped DEM's NaN margins stay out of it).
        const [lon, lat] = ctx.firstPoint(p.observer, { epsg: 4326 });
        const dLat = (p.md * 1.15) / 111320;
        const dLon = dLat / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
        src = T.translate(src, { projwin: [lon - dLon, lat + dLat, lon + dLon, lat - dLat], projwinSrs: "EPSG:4326" });
        ctx.log(`Read the ${p.md} m window around the observer`);
      }
      let dem = ctx.projectedDem(src);
      // Viewshed refuses NaN cells (NoData, or the margins a warp leaves): make them very low
      // ground, so they neither block nor add to the view.
      dem = T.calc("where(isnan(A), -10000, A)", { A: dem }, { type: "Float32", nodata: "none" });
      const crs = dem.info(false, false).crs;
      const pt = ctx.firstPoint(p.observer, crs);
      ctx.log(`Observer: ${pt[0].toFixed(1)}, ${pt[1].toFixed(1)}`);
      return [{ kind: "raster", name: p.out, ds: T.viewshed(dem, pt[0], pt[1], { oz: p.oz, tz: p.tz, md: p.md }), style: { colormap: "greens", rescaleMin: 0, rescaleMax: 255 } }];
    },
  },
  {
    id: "raster_calculator",
    name: "Raster Calculator",
    box: "spatial",
    set: "Map Algebra",
    help: 'Builds and runs a Map Algebra expression, as in ArcMap: rasters in double quotes, e.g. Float("b8" - "b4") / Float("b8" + "b4"), Con("dem" > 1000, 1, 0), SetNull("slope" > 45, "dem"). Double-click a layer or a function to add it. Integer rasters are computed as floating point.',
    params: [
      { name: "expr", label: "Map Algebra expression", type: "mapalgebra", required: true, default: "" },
      OUT("rastercalc"),
    ],
    run(T, p, ctx) {
      const inputs = p.expr.inputs;
      let expr = p.expr.expr;
      for (const k of Object.keys(inputs)) {
        // gdal_calc keeps integer types, so (A - B) / (A + B) on uint16 bands wraps and
        // truncates. Promote integer inputs inside the expression (block by block, no full
        // copy), as ArcGIS's Float() would, so indices like NDVI come out right.
        const type = inputs[k].info(false, false).bands?.[0]?.data_type ?? "";
        if (/Int|Byte/i.test(type)) {
          expr = expr.replace(new RegExp(`\\b${k}\\b`, "g"), `(${k}*1.0)`);
          ctx.log(`${k} is ${type}: computed as floating point so division is not truncated`);
        }
      }
      const opts = { type: "Float32", extent: "intersect" };
      // terrio's calc holds whole arrays, and every float intermediate of a 120-million-cell
      // band is ~1 GB, past WebAssembly's 4 GB. Inputs on one grid are computed in row strips
      // (the expression is per cell, so strips give the same result) and stitched back.
      const infos = Object.values(inputs).map((d) => d.info(false, false));
      const [w, hgt] = infos[0].size;
      const sameGrid = infos.every((i) => i.size[0] === w && i.size[1] === hgt && i.geo_transform.every((v, j) => Math.abs(v - infos[0].geo_transform[j]) < 1e-9));
      const STRIP_CELLS = 12e6;
      // The result is computed in memory, so the inputs can go before the output is written:
      // WebAssembly memory never shrinks, and a large COG needs the room.
      const release = () => Object.values(inputs).forEach((d) => d.free());
      if (!sameGrid || w * hgt <= STRIP_CELLS) {
        const out = T.calc(expr, inputs, opts);
        release();
        return [{ kind: "raster", name: p.out, ds: out }];
      }
      const rows = Math.max(1, Math.floor(STRIP_CELLS / w));
      const strips = [];
      for (let y = 0; y < hgt; y += rows) {
        const part = {};
        for (const [k, d] of Object.entries(inputs)) part[k] = T.translate(d, { srcwin: [0, y, w, Math.min(rows, hgt - y)] });
        strips.push(T.calc(expr, part, opts));
        for (const d of Object.values(part)) d.free();
      }
      ctx.log(`Computed in ${strips.length} strips of ${rows} rows to stay within WebAssembly memory`);
      const joined = T.mosaic(strips, {});
      const out = T.translate(joined, {}); // a raster of its own, so the strips can be released
      joined.free();
      strips.forEach((s) => s.free());
      release();
      return [{ kind: "raster", name: p.out, ds: out }];
    },
  },
  {
    id: "focal",
    name: "Focal Statistics",
    box: "spatial",
    set: "Neighborhood",
    help: "For each cell, a statistic of the cells in a square neighborhood around it.",
    params: [
      { name: "raster", label: "Input raster", type: "raster", required: true },
      { name: "size", label: "Neighborhood size (cells)", type: "number", default: 3, min: 3 },
      { name: "method", label: "Statistics type", type: "enum", options: ["mean", "sum", "min", "max", "stddev", "median", "mode"].map((m) => [m.toUpperCase(), m]), default: "mean" },
      OUT("{raster}_Focal"),
    ],
    run(T, p) {
      const n = Math.max(3, Math.round(p.size) | 1);
      return [{ kind: "raster", name: p.out, ds: T.neighbors(p.raster, { kernel: "equal", method: p.method, size: n, ot: "Float32" }) }];
    },
  },
  {
    id: "reclassify",
    name: "Reclassify",
    box: "spatial",
    set: "Reclass",
    help: "Maps value ranges to new values. AUTO n makes n equal intervals over the data range (classes 1..n). Or write one rule per line, e.g. [0,500)=1, [500,1000)=2, [1000,inf)=3, NO_DATA=NO_DATA.",
    params: [
      { name: "raster", label: "Input raster", type: "raster", required: true },
      { name: "mapping", label: "Reclassification", type: "text", required: true, default: "AUTO 5", multiline: true },
      OUT("{raster}_Reclass"),
    ],
    run(T, p, ctx) {
      // A NaN NoData collides with the NO_DATA rule, and a float NoData such as 3.4e38 does not
      // fit the Int16 output: give the band -9999 first. The data range for AUTO is read before,
      // while the old NoData still hides those cells.
      let src = p.raster;
      const stats = src.info(true, false).bands?.[0]?.statistics;
      const nd = Number(src.info(false, false).bands?.[0]?.nodata);
      const ndText = String(src.info(false, false).bands?.[0]?.nodata).toLowerCase();
      if (ndText === "nan" || (Number.isFinite(nd) && Math.abs(nd) > 32767)) {
        ctx.log(`NoData was ${ndText}: using -9999`);
        src = T.translate(src, { aNodata: -9999 });
      }
      let mapping = p.mapping.replace(/\s*\n\s*/g, ";").replace(/;+$/, "");
      const auto = /^\s*AUTO\s*(\d+)?/i.exec(mapping);
      if (auto) {
        // As ArcGIS does by default: equal intervals over the data range, classes 1..n.
        const n = Math.max(2, Math.min(32, Number(auto[1] ?? 5)));
        const s = stats;
        if (!s) throw new Error("Could not read the raster's range for AUTO classes");
        const step = (s.max - s.min) / n;
        const edges = Array.from({ length: n + 1 }, (_, i) => Number((s.min + i * step).toPrecision(6)));
        edges[0] = s.min; // exact, so the lowest cell is not rounded out of class 1
        mapping = edges
          .slice(0, n)
          // the first class starts at the data minimum, not -inf, which would swallow NoData
          .map((lo, i) => (i === n - 1 ? `[${lo},inf)=${i + 1}` : `[${lo},${edges[i + 1]})=${i + 1}`))
          .join(";");
        mapping += ";NO_DATA=NO_DATA";
        ctx.log(`AUTO: ${n} equal intervals: ${mapping}`);
      }
      // Values no rule covers (NaN edges of a warped DEM) become NoData, as in ArcGIS.
      if (!/DEFAULT\s*=/i.test(mapping)) mapping += ";DEFAULT=NO_DATA";
      return [{ kind: "raster", name: p.out, ds: T.reclassify(src, mapping, { ot: "Int16" }), style: { colormap: "tab10" } }];
    },
  },
  {
    id: "zonal",
    name: "Zonal Statistics as Table",
    box: "spatial",
    set: "Zonal",
    help: "Statistics of a raster within each polygon, added as fields to a copy of the zones.",
    params: [
      { name: "zones", label: "Input zone features", type: "fc", geom: "polygon", required: true },
      { name: "raster", label: "Input value raster", type: "raster", required: true },
      { name: "stats", label: "Statistics type", type: "enum", options: [["ALL", "count,min,max,mean,sum,stdev"], ["MEAN", "mean"], ["MIN / MAX", "min,max"], ["SUM", "sum"], ["MAJORITY", "majority"]], default: "count,min,max,mean,sum,stdev" },
      OUT("{zones}_Zonal"),
    ],
    run(T, p) {
      return [{ kind: "vector", name: p.out, ds: T.zonalStats(p.zones, [p.raster], { stats: p.stats.split(","), prefixes: ["z"], decimalPlaces: 3 }) }];
    },
  },
  {
    id: "euclidean",
    name: "Euclidean Distance",
    box: "spatial",
    set: "Distance",
    help: "Distance from every cell to the nearest non-zero (or listed) source cell, in the raster's coordinate units.",
    params: [
      { name: "raster", label: "Input source raster", type: "raster", required: true },
      { name: "values", label: "Source values (comma separated, empty = non-zero)", type: "text", default: "" },
      { name: "maxdist", label: "Maximum distance", type: "number", default: "" },
      OUT("{raster}_EucDist"),
    ],
    run(T, p) {
      const o = { distunits: "GEO" };
      if (p.values.trim()) o.values = p.values.split(",").map(Number);
      if (p.maxdist) o.maxdist = p.maxdist;
      return [{ kind: "raster", name: p.out, ds: T.proximity(p.raster, o), style: { colormap: "magma" } }];
    },
  },
];

/** Resolve "{param}" placeholders in a default output name from the chosen inputs' names. */
export function fillName(template, names) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) => (names[k] ?? k).replace(/[^\w\-. ]+/g, "_"));
}
