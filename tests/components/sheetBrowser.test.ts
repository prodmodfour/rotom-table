/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SheetBrowser from '~/components/SheetBrowser.vue'

const authState = vi.hoisted(() => ({
  isPlayer: { value: false },
}))

vi.mock('~/composables/useAuth', () => ({
  useAuth: () => ({
    isPlayer: authState.isPlayer,
  }),
}))

vi.mock('~/composables/useLiveSheets', () => ({
  useLiveSheets: () => ({
    pokemonBySlug: { value: new Map() },
    trainerBySlug: { value: new Map() },
  }),
}))

const mountBrowser = () => mount(SheetBrowser)

describe('SheetBrowser', () => {
  it('renders breadcrumbs for non-player browsers', () => {
    authState.isPlayer.value = false

    const wrapper = mountBrowser()

    expect(wrapper.find('.browser-crumbs').exists()).toBe(true)
  })

  it('does not render breadcrumbs for players', () => {
    authState.isPlayer.value = true

    const wrapper = mountBrowser()

    expect(wrapper.find('.browser-crumbs').exists()).toBe(false)
  })
})
