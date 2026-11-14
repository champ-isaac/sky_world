import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CameraEventType,
  Cartesian3,
  Color,
  Credit,
  ImageryLayer,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
  Viewer,
  buildModuleUrl,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { Camera } from 'cesium'

type Place = { lon: number; lat: number }

// Camera height above the user's location when it is first found.
const VIEW_HEIGHT_M = 8_000_000
// Camera height for the My location close-up: ~10 m per screen pixel, the native
// resolution of the EOX imagery and labels at zoom 14.
const CLOSE_UP_HEIGHT_M = 10_000

// Each mouse-wheel notch (a wheel delta of 120) moves the camera this share of its
// distance to the marker, and zooming in stops this far from it.
const WHEEL_ZOOM_STEP = 0.2
const WHEEL_NOTCH_DELTA = 120
const MIN_MARKER_DISTANCE_M = 200

// EOX Sentinel-2 cloudless 2025, 10 m/pixel (native up to zoom 14). No key needed.
// Licence is CC BY-NC-SA 4.0: non-commercial use only, attribution required.
const EOX_URL =
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg'
const EOX_CREDIT =
  '<a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless 2025</a> by EOX IT Services GmbH ' +
  '(Contains modified Copernicus Sentinel data 2025), ' +
  '<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>'

// EOX overlay: transparent roads, borders and place/road names from OpenStreetMap (up to zoom 14). No key needed.
const EOX_LABELS_URL =
  'https://tiles.maps.eox.at/wmts/1.0.0/overlay_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.png'
const EOX_LABELS_CREDIT =
  'Labels: data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, ' +
  'rendering © <a href="https://eox.at" target="_blank" rel="noopener">EOX</a> and ' +
  '<a href="https://github.com/mapserver/basemaps" target="_blank" rel="noopener">MapServer</a>'

const flyTo = (viewer: Viewer, { lon, lat }: Place, height: number) =>
  viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(lon, lat, height) })

// Moving the camera along its line to the marker keeps the marker at the same spot on screen.
function zoomTowards(camera: Camera, target: Cartesian3, wheelDelta: number) {
  const distance = Cartesian3.distance(camera.positionWC, target)
  // Scale the step by the wheel delta, compounding, so a trackpad's many small deltas
  // zoom as far in total as one notch of the same size.
  const notches = Math.abs(wheelDelta) / WHEEL_NOTCH_DELTA
  const amount =
    wheelDelta > 0
      ? Math.min(
          distance * (1 - (1 - WHEEL_ZOOM_STEP) ** notches),
          distance - MIN_MARKER_DISTANCE_M,
        )
      : -distance * ((1 + WHEEL_ZOOM_STEP) ** notches - 1)
  // Already at the closest allowed distance (1 m slack absorbs floating-point error).
  if (wheelDelta > 0 && amount < 1) return
  const direction = Cartesian3.normalize(
    Cartesian3.subtract(target, camera.positionWC, new Cartesian3()),
    new Cartesian3(),
  )
  camera.move(direction, amount)
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer>(null)
  const [here, setHere] = useState<Place | 'pending' | 'unavailable'>('pending')
  const [message, setMessage] = useState('')
  const [buttonSlot, setButtonSlot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    // Bundled Natural Earth imagery: works offline, no Cesium ion token needed.
    // It stays underneath EOX as the fallback while tiles load or if EOX is unreachable.
    const viewer = new Viewer(containerRef.current!, {
      baseLayer: ImageryLayer.fromProviderAsync(
        TileMapServiceImageryProvider.fromUrl(
          buildModuleUrl('Assets/Textures/NaturalEarthII'),
        ),
      ),
      baseLayerPicker: false,
      geocoder: false,
      animation: false,
      timeline: false,
      // Render at the full device pixel ratio so imagery stays crisp on Retina screens.
      useBrowserRecommendedResolution: false,
    })
    viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: EOX_URL,
        maximumLevel: 14,
        credit: new Credit(EOX_CREDIT, true),
      }),
    )
    // Added last so the labels sit on top of both imagery layers.
    viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: EOX_LABELS_URL,
        maximumLevel: 14,
        credit: new Credit(EOX_LABELS_CREDIT, true),
      }),
    )
    viewerRef.current = viewer

    // Slot in Cesium's toolbar, just before its Home button, for the My location button.
    const home = viewer.container.querySelector('.cesium-home-button')!
    const slot = document.createElement('span')
    home.before(slot)
    setButtonSlot(slot)

    // Slow spin around the Earth's axis, until the user's location is known.
    const spin = viewer.clock.onTick.addEventListener(() =>
      viewer.scene.camera.rotate(Cartesian3.UNIT_Z, -0.002),
    )

    // StrictMode mounts twice; ignore answers that arrive for a destroyed viewer.
    let active = true
    let wheel: ScreenSpaceEventHandler | undefined
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          if (!active) return
          const place = { lon: coords.longitude, lat: coords.latitude }
          const marker = Cartesian3.fromDegrees(place.lon, place.lat)
          spin()
          viewer.entities.add({
            position: marker,
            point: {
              pixelSize: 12,
              color: Color.DODGERBLUE,
              outlineColor: Color.WHITE,
              outlineWidth: 2,
            },
          })
          flyTo(viewer, place, VIEW_HEIGHT_M)

          // Cesium's wheel zoom heads for the point under the cursor, which lets the marker
          // slide off screen. Take the wheel over and zoom towards the marker instead.
          viewer.scene.screenSpaceCameraController.zoomEventTypes = [
            CameraEventType.RIGHT_DRAG,
            CameraEventType.PINCH,
          ]
          wheel = new ScreenSpaceEventHandler(viewer.scene.canvas)
          wheel.setInputAction(
            (delta: number) => zoomTowards(viewer.camera, marker, delta),
            ScreenSpaceEventType.WHEEL,
          )
          setHere(place)
          setMessage('')
        },
        () => {
          if (active) setHere('unavailable')
        },
        { timeout: 15_000 },
      )
    } else {
      setHere('unavailable')
    }

    return () => {
      active = false
      wheel?.destroy()
      spin()
      viewer.destroy()
    }
  }, [])

  const centerOnMe = () => {
    if (typeof here === 'object') flyTo(viewerRef.current!, here, CLOSE_UP_HEIGHT_M)
    else setMessage(here === 'pending' ? 'Finding your location…' : 'Location unavailable')
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {buttonSlot &&
        createPortal(
          <button
            type="button"
            className="cesium-button cesium-toolbar-button"
            aria-label="My location"
            title="My location"
            onClick={centerOnMe}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
              <path d="M21 3 3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z" />
            </svg>
          </button>,
          buttonSlot,
        )}
      {message && (
        <p
          role="status"
          style={{ position: 'absolute', top: 40, right: 8, margin: 0, color: 'white' }}
        >
          {message}
        </p>
      )}
    </div>
  )
}

export default App
