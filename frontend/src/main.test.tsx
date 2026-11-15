import { expect, test, vi } from 'vitest'

const render = vi.hoisted(() => vi.fn())
const createRoot = vi.hoisted(() => vi.fn(() => ({ render })))

vi.mock('react-dom/client', () => ({ createRoot }))
vi.mock('./App.tsx', () => ({ default: () => null }))

test('mounts the app into #root', async () => {
  document.body.innerHTML = '<div id="root"></div>'

  await import('./main.tsx')

  expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'))
  expect(render).toHaveBeenCalledOnce()
})
