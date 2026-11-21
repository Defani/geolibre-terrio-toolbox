# Terrio Toolbox for GeoLibre

An ArcGIS Pro-style **Geoprocessing pane** for [GeoLibre](https://github.com/opengeos/GeoLibre), docked on the right like ArcMap's ArcToolbox. The engine is [terrio-js](https://terrio.dev) (MIT): GDAL-class raster and vector processing written in Rust and run in the browser through WebAssembly. No Python, GDAL install, or server is needed.

- 36 tools in 4 toolboxes, black-and-white UI that follows the GeoLibre theme
- Every run shows its elapsed seconds and is kept in **History**
- ArcMap-style **Raster Calculator** (Con, SetNull, Pick, Float, Int, trig, keypad)
- Handles large rasters: full Sentinel-2 tiles (2 × 121 million cells) run in the app

Tutorial (Bahasa Indonesia, with screenshots): https://defanialways.fun

## Install

1. Download `terrio-toolbox-<version>.zip` from [Releases](../../releases), or build it (below).
2. GeoLibre → **Settings → Manage plugins → Settings → Choose .zip…** and pick the zip.
3. **Plugins → Installed → Terrio Toolbox**. The pane opens on the right.

For development, serve this folder and add `http://127.0.0.1:<port>/plugin/plugin.json` under **Manifest URLs** instead.

## Tools

| Toolbox | Toolset | Tools |
| --- | --- | --- |
| Analysis | Extract | Clip, Select |
| | Overlay | Erase, Intersect, Union, Symmetrical Difference, Identity, Update |
| | Proximity | Buffer |
| Conversion | From Raster | Raster to Polygon, Raster To ASCII, Raster To Other Format |
| | To Raster | Feature to Raster |
| | To File | Feature Class To File (GPKG, Shapefile, GeoParquet, FlatGeobuf, KML/KMZ, DXF, CSV) |
| Data Management | Features | Repair Geometry, Multipart To Singlepart, Minimum Bounding Geometry |
| | Generalization | Dissolve, Simplify |
| | Projections | Define Projection, Project Raster |
| | Raster | Clip (Raster), Mosaic To New Raster, Resample, Fill NoData |
| Spatial Analyst | Surface | Hillshade, Slope, Aspect, Terrain Ruggedness, Contour, Viewshed |
| | Map Algebra | Raster Calculator |
| | Neighborhood | Focal Statistics |
| | Reclass | Reclassify |
| | Zonal | Zonal Statistics as Table |
| | Distance | Euclidean Distance |

### Raster Calculator

Write expressions as in ArcMap; raster names go in double quotes:

```
Float("b8.tif" - "b4.tif") / Float("b8.tif" + "b4.tif")
Con("dem.tif" > 1000, 1, 0)
SetNull("slope.tif" > 45, "dem.tif")
```

Integer bands are promoted to floating point automatically, so NDVI on uint16 imagery does not wrap.

### Notes

- GeoLibre does not share the bytes of rasters added from local files with plugins. Use the folder button on a raster parameter to pick the file, or add the raster from a URL. Outputs of earlier Terrio runs can be chained directly.
- A raster with no coordinate system whose coordinates are plainly degrees (DEMNAS tiles ship like this) is assumed to be WGS 84.
- For very large rasters, run **Clip (Raster)** to your area first.

## Build and test

```bash
npm install
npm run build          # plugin/ folder and terrio-toolbox-<version>.zip
npm test               # every tool on sample data + Map Algebra translation checks
```

`test/real.test.mjs` and `test/big.test.mjs` run the tools on local DEMNAS, RBI and Sentinel-2 files; edit the paths at the top to point at your own data.

## License

MIT. terrio-js is MIT; its bundled third-party licenses are copied into the build.
