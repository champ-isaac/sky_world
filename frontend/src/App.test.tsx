import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  CameraEventType,
  Cartesian3,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
} from 'cesium'
import App from './App'

// jsdom has no WebGL, so the Viewer is faked. The rest of cesium stays real.
const viewer = vi.hoisted(() => ({
  instances: [] as { container: HTMLElement; options: Record<string, unknown> }[],
  tick: undefined as undefined | (() => void),
  unsubscribe: vi.fn(),
  rotate: vi.fn(),
  flyTo: vi.fn(),
  addEntity: vi.fn(),
  addImageryProvider: vi.fn(),
  destroy: vi.fn(),
  move: vi.fn(),
  cameraPosition: undefined as undefined | Cartesian3,
  zoomEventTypes: [] as unknown[],
  canvas: undefined as undefined | HTMLCanvasElement,
}))

// Wheel handlers the app registers, so tests can turn the wheel and check cleanup.
const wheel = vi.hoisted(() => ({
  handlers: [] as { element: unknown; action?: (delta: number) => void; type?: unknown }[],
  destroy: vi.fn(),
}))

// The browser's location answer, captured so each test decides when and how it arrives.
const geo = vi.hoisted(() => ({
  success: undefined as undefined | PositionCallback,
  error: undefined as undefined | PositionErrorCallback,
  options: undefined as undefined | PositionOptions,
}))

const located = () =>
  act(() =>
    geo.success!({ coords: { longitude: 121.5, latitude: 25 } } as GeolocationPosition),
  )
const denied = () => act(() => geo.error!({ code: 1 } as GeolocationPositionError))
const myLocation = () => fireEvent.click(screen.getByRole('button', { name: 'My location' }))
const marker = () => Cartesian3.fromDegrees(121.5, 25)
// Puts the camera straight above the marker and turns the wheel once.
const turnWheel = (heightAboveMarker: number, delta: number) => {
  viewer.cameraPosition = Cartesian3.fromDegrees(121.5, 25, heightAboveMarker)
  wheel.handlers[0].action!(delta)
}

vi.mock('cesium', async (importOriginal) => ({
  ...(await importOriginal<typeof import('cesium')>()),
  Viewer: class {
    clock = {
      onTick: {
        addEventListener: (cb: () => void) => {
          viewer.tick = cb
          return viewer.unsubscribe
        },
      },
    }
    scene = {
      camera: { rotate: viewer.rotate },
      canvas: viewer.canvas,
      screenSpaceCameraController: {
        set zoomEventTypes(types: unknown[]) {
          viewer.zoomEventTypes = types
        },
      },
    }
    camera = {
      flyTo: viewer.flyTo,
      move: viewer.move,
      get positionWC() {
        return viewer.cameraPosition
      },
    }
    entities = { add: viewer.addEntity }
    imageryLayers = { addImageryProvider: viewer.addImageryProvider }
    destroy = viewer.destroy
    container: HTMLElement
    constructor(container: HTMLElement, options: Record<string, unknown>) {
      // Same toolbar markup Cesium builds: Home is a direct child of the toolbar.
      container.innerHTML =
        '<div class="cesium-viewer-toolbar"><button class="cesium-home-button"></button></div>'
      this.container = container
      viewer.instances.push({ container, options })
    }
  },
  ScreenSpaceEventHandler: class {
    destroy = wheel.destroy
    constructor(element: unknown) {
      wheel.handlers.push({ element })
    }
    setInputAction(action: (delta: number) => void, type: unknown) {
      Object.assign(wheel.handlers.at(-1)!, { action, type })
    }
  },
}))

beforeEach(() => {
  viewer.instances = []
  viewer.tick = undefined
  viewer.cameraPosition = undefined
  viewer.zoomEventTypes = []
  viewer.canvas = document.createElement('canvas')
  wheel.handlers = []
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (
        ok: PositionCallback,
        fail: PositionErrorCallback,
        options?: PositionOptions,
      ) => {
        geo.success = ok
        geo.error = fail
        geo.options = options
      },
    },
  })
})

afterEach(cleanup)

test('creates a token-free viewer in the rendered container', () => {
  const { container } = render(<App />)

  expect(viewer.instances).toHaveLength(1)
  const { container: target, options } = viewer.instances[0]
  expect(target).toBe(container.firstChild!.firstChild)
  expect(options).toMatchObject({
    baseLayerPicker: false,
    geocoder: false,
    animation: false,
    timeline: false,
    useBrowserRecommendedResolution: false,
  })
  expect(options.baseLayer).toBeDefined()
})

test('adds EOX Sentinel-2 imagery over Natural Earth, with on-screen attribution', () => {
  render(<App />)

  const [provider] = viewer.addImageryProvider.mock.calls[0]
  expect(provider).toBeInstanceOf(UrlTemplateImageryProvider)
  expect(provider.url).toBe(
    'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
  )
  expect(provider.maximumLevel).toBe(14)
  expect(provider.credit.showOnScreen).toBe(true)
  expect(provider.credit.html).toContain('EOX IT Services GmbH')
  expect(provider.credit.html).toContain('Copernicus Sentinel data 2025')
  expect(provider.credit.html).toContain('CC BY-NC-SA 4.0')
})

test('adds the EOX label overlay on top of the imagery, with on-screen attribution', () => {
  render(<App />)

  // Imagery layers draw in the order added, so the last one is on top.
  expect(viewer.addImageryProvider).toHaveBeenCalledTimes(2)
  const [labels] = viewer.addImageryProvider.mock.calls[1]
  expect(labels).toBeInstanceOf(UrlTemplateImageryProvider)
  expect(labels.url).toBe(
    'https://tiles.maps.eox.at/wmts/1.0.0/overlay_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.png',
  )
  expect(labels.maximumLevel).toBe(14)
  expect(labels.credit.showOnScreen).toBe(true)
  expect(labels.credit.html).toContain('OpenStreetMap</a> contributors')
  expect(labels.credit.html).toContain('EOX</a>')
})

test('spins the camera around the Earth axis on each tick', () => {
  render(<App />)

  viewer.tick!()

  expect(viewer.rotate).toHaveBeenCalledWith(Cartesian3.UNIT_Z, -0.002)
})

test('unsubscribes the spin and destroys the viewer on unmount', () => {
  const { unmount } = render(<App />)

  unmount()

  expect(viewer.unsubscribe).toHaveBeenCalledOnce()
  expect(viewer.destroy).toHaveBeenCalledOnce()
})

test('removes the wheel handler on unmount', () => {
  const { unmount } = render(<App />)
  located()

  unmount()

  expect(wheel.destroy).toHaveBeenCalledOnce()
})

test('puts the My location button just before the Home button', () => {
  render(<App />)

  const home = document.querySelector('.cesium-home-button')!
  expect(home.previousElementSibling!.firstElementChild).toBe(
    screen.getByRole('button', { name: 'My location' }),
  )
})

test('asks for the location with a 15 second timeout', () => {
  render(<App />)

  expect(geo.options).toEqual({ timeout: 15_000 })
})

test('marks the user location, stops the spin and flies there', () => {
  render(<App />)

  located()

  expect(viewer.unsubscribe).toHaveBeenCalledOnce()
  const [{ position, point }] = viewer.addEntity.mock.calls[0]
  expect(position).toEqual(Cartesian3.fromDegrees(121.5, 25))
  expect(point).toBeDefined()
  expect(viewer.flyTo).toHaveBeenCalledWith({
    destination: Cartesian3.fromDegrees(121.5, 25, 8_000_000),
  })
})

test('the button flies to a 10 km close-up of the user location', () => {
  render(<App />)
  located()
  viewer.flyTo.mockClear()

  myLocation()

  expect(viewer.flyTo).toHaveBeenCalledExactlyOnceWith({
    destination: Cartesian3.fromDegrees(121.5, 25, 10_000),
  })
  expect(screen.queryByRole('status')).toBeNull()
})

test('once located, the wheel is taken from Cesium zoom and handled on the canvas', () => {
  render(<App />)
  expect(wheel.handlers).toHaveLength(0)

  located()

  expect(viewer.zoomEventTypes).toEqual([CameraEventType.RIGHT_DRAG, CameraEventType.PINCH])
  expect(wheel.handlers).toHaveLength(1)
  expect(wheel.handlers[0].element).toBe(viewer.canvas)
  expect(wheel.handlers[0].type).toBe(ScreenSpaceEventType.WHEEL)
})

test('one mouse notch (delta 120) moves the camera a fifth of the way straight towards the marker', () => {
  render(<App />)
  located()

  turnWheel(1000, 120)

  const [direction, amount] = viewer.move.mock.calls[0]
  const towardsMarker = Cartesian3.normalize(
    Cartesian3.subtract(marker(), viewer.cameraPosition!, new Cartesian3()),
    new Cartesian3(),
  )
  expect(Cartesian3.equalsEpsilon(direction, towardsMarker, 1e-9)).toBe(true)
  expect(amount).toBeCloseTo(200, 3)
})

test('one mouse notch out (delta -120) moves the camera a fifth away along the same line', () => {
  render(<App />)
  located()

  turnWheel(1000, -120)

  expect(viewer.move.mock.calls[0][1]).toBeCloseTo(-200, 3)
})

test('a trackpad-sized wheel delta takes a proportionally small step', () => {
  render(<App />)
  located()

  turnWheel(1000, 4)
  turnWheel(1000, -4)

  expect(viewer.move.mock.calls[0][1]).toBeCloseTo(1000 * (1 - 0.8 ** (4 / 120)), 3) // ~7.4 m
  expect(viewer.move.mock.calls[1][1]).toBeCloseTo(-1000 * (1.2 ** (4 / 120) - 1), 3) // ~6.1 m
})

test('thirty trackpad deltas of 4 zoom as far in total as one 120 notch', () => {
  render(<App />)
  located()
  let distance = 1000
  for (let i = 0; i < 30; i++) {
    turnWheel(distance, 4)
    distance -= viewer.move.mock.calls[i][1]
  }

  expect(distance).toBeCloseTo(800, 3)
})

test('wheel in stops 200 m from the marker', () => {
  render(<App />)
  located()

  turnWheel(210, 120)
  turnWheel(200, 120)

  expect(viewer.move).toHaveBeenCalledOnce()
  expect(viewer.move.mock.calls[0][1]).toBeCloseTo(10, 3)
})

test('the button says so while the location is still being found', () => {
  render(<App />)

  myLocation()

  expect(screen.getByRole('status').textContent).toBe('Finding your location…')
})

test('keeps spinning and reports it when permission is denied', () => {
  render(<App />)
  denied()

  myLocation()

  expect(viewer.unsubscribe).not.toHaveBeenCalled()
  expect(viewer.flyTo).not.toHaveBeenCalled()
  expect(wheel.handlers).toHaveLength(0) // Cesium keeps its normal wheel zoom
  expect(screen.getByRole('status').textContent).toBe('Location unavailable')
})

test('reports it when the browser has no geolocation', () => {
  delete (navigator as { geolocation?: Geolocation }).geolocation
  render(<App />)

  myLocation()

  expect(screen.getByRole('status').textContent).toBe('Location unavailable')
})

test('ignores a location that arrives after unmount', () => {
  const { unmount } = render(<App />)
  unmount()

  located()
  denied()

  expect(viewer.addEntity).not.toHaveBeenCalled()
  expect(viewer.flyTo).not.toHaveBeenCalled()
})
