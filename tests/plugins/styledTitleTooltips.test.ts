/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const controllerKey = '__rotomStyledTitleTooltipController'

type PluginHook = () => void

afterEach(() => {
  const windowWithController = window as Window & Record<string, { destroy?: () => void } | undefined>
  windowWithController[controllerKey]?.destroy?.()
  delete windowWithController[controllerKey]
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('styled title tooltip plugin hydration timing', () => {
  it('does not mutate SSR title attributes until page hydration finishes and the next frame begins', async () => {
    vi.stubGlobal('defineNuxtPlugin', (setup: unknown) => setup)

    document.body.innerHTML = '<button type="button" title="Hydration-safe title">Action</button>'
    const button = document.querySelector('button')!
    const hooks = new Map<string, PluginHook>()
    let scheduledStart: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      scheduledStart = callback
      return 1
    })
    const plugin = (await import('~/plugins/styled-title-tooltips.client')).default as unknown as (
      app: { hook: (name: string, callback: PluginHook) => void },
    ) => void

    plugin({
      hook: (name, callback) => {
        hooks.set(name, callback)
      },
    })

    expect(hooks.has('app:mounted')).toBe(false)
    expect(hooks.has('app:suspense:resolve')).toBe(false)
    expect(hooks.has('page:finish')).toBe(true)
    expect(button.getAttribute('title')).toBe('Hydration-safe title')
    expect(button.hasAttribute('data-styled-tooltip')).toBe(false)

    hooks.get('page:finish')?.()

    expect(button.getAttribute('title')).toBe('Hydration-safe title')
    expect(scheduledStart).not.toBeNull()
    scheduledStart?.(0)

    expect(button.getAttribute('title')).toBe('')
    expect(button.getAttribute('data-styled-tooltip')).toBe('Hydration-safe title')
  })
})
