# sky_world
A Real 3D World Visualization Platform for Displaying Restricted Airspace, Planning Flight Paths, and More.

[![Branch](https://img.shields.io/badge/branch-master-blue)](https://github.com/champ-isaac/sky_world/tree/master)
[![CI](https://github.com/champ-isaac/sky_world/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/champ-isaac/sky_world/actions/workflows/ci.yml)
![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
[![Last commit](https://img.shields.io/github/last-commit/champ-isaac/sky_world/master)](https://github.com/champ-isaac/sky_world/commits/master)

Tests: `npm run test` (`vitest run`). Coverage: `npm run coverage` (`vitest run --coverage`),
both from `frontend/`. The coverage badge is set by hand from the last local run
(100% lines, 20 of 20 tests passing) and must be updated when coverage changes.

## Architecture (current)

```
browser ──http://localhost:5173──▶ frontend container (Vite dev server)
                                     └─ React + TypeScript app
                                          └─ CesiumJS Viewer: 3D Earth globe
```

- `frontend/`: React + TypeScript app built with Vite. `src/App.tsx` creates a full-screen
  CesiumJS `Viewer` that shows a slowly rotating globe until the user's location is found.
- Imagery is EOX tiles, with the Natural Earth II texture that ships with CesiumJS beneath
  as the fallback, so no Cesium ion account or token is needed. Terrain is the plain WGS84 ellipsoid.
- CesiumJS static files (workers, assets, widgets) are served from `/cesium`.
  `frontend/public/cesium` is a symlink to `node_modules/cesium/Build/Cesium`, and
  `vite.config.ts` sets `CESIUM_BASE_URL` to `/cesium`.
- `docker-compose.yml` runs one service, `frontend`, built from `frontend/Dockerfile`
  (Node 24). It mounts `frontend/` into the container so code changes hot-reload, and
  keeps the container's own `node_modules`.

There is no backend yet.

## My location

On load the app asks for the browser's location. If allowed, it stops the spin, places a
blue marker at the user's position and flies the camera there. The arrow button in the
toolbar, left of Home, flies the camera to a 10 km close-up of the marker. If location is
denied or unavailable, the globe keeps spinning and the button shows a short message.

## Wheel zoom towards the marker

Once the location is known, the mouse wheel zooms straight towards (or away from) the
marker, so it stays at the same spot on screen (`zoomTowards` in `frontend/src/App.tsx`):

- One mouse notch (wheel delta 120) moves the camera 20% of its distance to the marker.
- Smaller deltas, such as trackpad scrolling, take proportionally smaller steps. The steps
  compound, so many small deltas add up to the same zoom as one notch of the same total.
- Zooming in stops 200 m from the marker.

Before the location is known, or if it is denied, Cesium's normal wheel zoom applies.

## EOX imagery and labels

Two EOX tile layers are drawn on top of Natural Earth II, which stays underneath as the
fallback. Neither needs an API key. Both go up to zoom level 14, and their attribution is
shown on the map.

- **Imagery:** EOxCloudless 2025 (Sentinel-2 cloudless, `s2cloudless-2025_3857`), licensed
  [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), so non-commercial
  use only. Attribution: "EOxCloudless 2025 by EOX IT Services GmbH (Contains modified
  Copernicus Sentinel data 2025)".
- **Labels:** EOX overlay (`overlay_3857`), transparent roads, borders and place names.
  Attribution: "Labels: data © OpenStreetMap contributors, rendering © EOX and MapServer".
  The licence for this layer is not confirmed in the code or docs here.

## Vite polling for Docker on macOS

`frontend/vite.config.ts` sets `server.watch.usePolling: true`. The `frontend` service in
`docker-compose.yml` bind-mounts `./frontend` into the container, and on macOS file change
events don't reach the container through that mount. Without polling, Vite misses edits
and keeps serving old code until the container restarts.

## Run with Docker

Requires Docker with Compose.

```sh
docker compose up --build
```

Open http://localhost:5173. Stop with `Ctrl+C`, or `docker compose down`.

After changing `frontend/package.json`, run `docker compose up --build --renew-anon-volumes`
so the container reinstalls dependencies.

## Run without Docker

```sh
cd frontend
npm install
npm run dev
```
