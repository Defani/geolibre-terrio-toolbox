// Helpers the tools share inside the worker: coordinate systems, UTM zones, outputs.

/** The EPSG code of the WGS84 UTM zone holding a longitude/latitude. */
export function utmEpsg(lon, lat) {
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  return `EPSG:${lat < 0 ? 327 : 326}${String(zone).padStart(2, "0")}`;
}

function crsString(crs) {
  if (!crs) return null;
  return crs.epsg ? `EPSG:${crs.epsg}` : crs.wkt || null;
}

export function makeContext(T, log) {
  const isGeographic = (crs) => {
    const s = crsString(crs);
    if (!s) return false;
    try {
      return !!T.describeCrs(s).geographic;
    } catch {
      return false;
    }
  };

  /** Longitude/latitude of a dataset's center. */
  const centerLonLat = (ds) => {
    const info = ds.info(false, false);
    const crsOf = info.type === "raster" ? info.crs : info.layers?.[0]?.crs;
    if (!crsString(crsOf)) throw new Error("The input has no coordinate system. Set one with Define Projection first.");
    if (info.type === "raster") {
      const e = info.extent;
      const [cx, cy] = [(e[0] + e[2]) / 2, (e[1] + e[3]) / 2];
      if (isGeographic(info.crs)) return [cx, cy];
      const [xs, ys] = T.transformPoints(new Float64Array([cx]), new Float64Array([cy]), crsString(info.crs), "EPSG:4326", null, {});
      return [xs[0], ys[0]];
    }
    const layer = info.layers[0];
    const e = layer.extent;
    const [cx, cy] = [(e[0] + e[2]) / 2, (e[1] + e[3]) / 2];
    if (isGeographic(layer.crs)) return [cx, cy];
    const [xs, ys] = T.transformPoints(new Float64Array([cx]), new Float64Array([cy]), crsString(layer.crs), "EPSG:4326", null, {});
    return [xs[0], ys[0]];
  };

  const ctx = {
    log,
    utmEpsg,
    isGeographic,
    /** A vector dataset reprojected to the UTM zone of its center. */
    toUTM(ds) {
      const [lon, lat] = centerLonLat(ds);
      const epsg = utmEpsg(lon, lat);
      log(`Projected to ${epsg} (UTM zone of the data) for metric units`);
      return T.open(ds.toBytes("utm.fgb", { tSrs: epsg }), "utm.fgb");
    },
    /** A vector dataset as WGS84 GeoJSON for GeoLibre. */
    toWGS(ds) {
      const layer = ds.info(false, false).layers?.[0];
      if (layer && layer.crs?.epsg === 4326) return ds.toGeoJSON(0);
      return T.open(ds.toBytes("wgs.fgb", { tSrs: "EPSG:4326" }), "wgs.fgb").toGeoJSON(0);
    },
    utmOfRaster(ds) {
      const [lon, lat] = centerLonLat(ds);
      return utmEpsg(lon, lat);
    },
    /** dem() options for a DEM in degrees: GDAL's -s 111120 (meters per degree). */
    demScale(ds) {
      const info = ds.info(false, false);
      if (!isGeographic(info.crs)) return {};
      log("The DEM is in degrees: using scale 111120 (meters per degree), as GDAL does");
      return { scale: 111120 };
    },
    /** The DEM itself when projected, else warped to its UTM zone at about its resolution. */
    projectedDem(ds) {
      const info = ds.info(false, false);
      if (!isGeographic(info.crs)) return ds;
      const epsg = ctx.utmOfRaster(ds);
      const res = Math.abs(info.geo_transform[1]) * 111320 * Math.cos(((info.extent[1] + info.extent[3]) / 2) * (Math.PI / 180));
      const cell = Math.max(0.01, Math.round(res * 100) / 100);
      log(`The DEM is in degrees: projecting to ${epsg} at ${cell} m first`);
      return T.warp(ds, { tSrs: epsg, tr: [cell, cell], resampling: "bilinear" });
    },
    /** The first point of a feature layer, in the given CRS. */
    firstPoint(fc, crs) {
      const gj = fc.toGeoJSON(0);
      const feature = gj.features.find((f) => f.geometry?.type === "Point" || f.geometry?.type === "MultiPoint");
      if (!feature) throw new Error("The observer layer has no point");
      const c = feature.geometry.type === "Point" ? feature.geometry.coordinates : feature.geometry.coordinates[0];
      const [xs, ys] = T.transformPoints(new Float64Array([c[0]]), new Float64Array([c[1]]), "EPSG:4326", crsString(crs), null, {});
      return [xs[0], ys[0]];
    },
    /** Min/max of band 1, for the colour stretch on the map. */
    bandRange(ds) {
      try {
        const s = ds.info(true, false).bands?.[0]?.statistics;
        return s ? { min: s.min, max: s.max, mean: s.mean } : null;
      } catch {
        return null;
      }
    },
  };
  return ctx;
}
