# Terrio Toolbox for GeoLibre

A **geoprocessing toolbox pane** for [GeoLibre](https://github.com/opengeos/GeoLibre), docked on the right. The engine is [terrio-js](https://terrio.dev) (MIT): GDAL-class raster and vector processing written in Rust and run in the browser through WebAssembly. No Python, GDAL install, or server is needed.

- 36 tools in 4 toolboxes, black-and-white UI that follows the GeoLibre theme
- Every run shows its elapsed seconds and is kept in **History**
- **Raster Calculator** with expressions (Con, SetNull, Pick, Float, Int, trig, keypad), spectral index templates and a threshold builder
- Handles large rasters: full Sentinel-2 tiles (2 × 121 million cells) run in the app

Tutorial (Bahasa Indonesia, with screenshots): https://defanialways.fun/tutorial/terrio-toolbox/

## Install

1. Download `terrio-toolbox-<version>.zip` from [Releases](../../releases), or build it (below).
2. GeoLibre → **Settings → Manage plugins → Settings → Choose .zip…** and pick the zip.
3. **Plugins → Installed → Terrio Toolbox**. The pane opens on the right.

For development, serve this folder and add `http://127.0.0.1:<port>/plugin/plugin.json` under **Manifest URLs** instead.

## Tools

| Toolbox | Toolset | Tools |
| --- | --- | --- |
| Vector Analysis | Extract | Clip, Select |
| | Overlay | Erase, Intersect, Union, Symmetrical Difference, Identity, Update |
| | Proximity | Buffer |
| Convert & Export | Raster to Vector & File | Raster to Polygon, Raster to ASCII Grid, Export Raster |
| | Vector to Raster | Vector to Raster |
| | Export Vector | Export Features (GPKG, Shapefile, GeoParquet, FlatGeobuf, KML/KMZ, DXF, CSV) |
| Data Preparation | Geometry | Repair Geometry, Explode Multipart, Bounding Geometry |
| | Simplify & Merge | Dissolve, Simplify |
| | Coordinate Systems | Define Projection, Project Raster |
| | Raster Prep | Clip (Raster), Mosaic Rasters, Resample, Fill NoData |
| Raster Analysis | Terrain | Hillshade, Slope, Aspect, Terrain Ruggedness, Contour, Viewshed |
| | Raster Math | Raster Calculator |
| | Focal | Focal Statistics |
| | Classify | Reclassify |
| | Zonal | Zonal Statistics |
| | Distance | Euclidean Distance |

### Raster Calculator

Three tabs:

- **Expression**: write a formula; raster names go in double quotes. Double-click a layer or a function to insert it.

  ```
  Float("b8.tif" - "b4.tif") / Float("b8.tif" + "b4.tif")
  Con("dem.tif" > 1000, 1, 0)
  SetNull("slope.tif" > 45, "dem.tif")
  ```

- **Index**: pick a template (NDVI, GNDVI, NDRE, SAVI, EVI, NDWI, MNDWI, NDMI, NDBI, NBR, or any normalized difference) and choose which raster is each band. Bands are guessed from file names (Sentinel-2 `B8` = NIR, `B4` = Red, Landsat `SR_B5` = NIR, ...).
- **Threshold**: pick a raster, an operator (`> >= < <= == !=`) and a value, and keep **True = 1, False = 0**, **True only** (False = NoData), or **True only with the raster's values**.

Integer bands are computed as floating point, so NDVI on uint16 imagery does not wrap. NoData in any input stays NoData.

### Notes

- GeoLibre does not share the bytes of rasters added from local files with plugins. Such layers are marked **pick file**: click it (or the folder button) and choose the same file once per session. Rasters added from a URL and outputs of earlier Terrio runs are read directly.
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
