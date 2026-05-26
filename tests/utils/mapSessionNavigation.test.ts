import { describe, expect, it } from 'vitest'
import { buildMapSessionNavigationModel } from '~/utils/mapSessionNavigation'

const linkMap = (model: ReturnType<typeof buildMapSessionNavigationModel>) =>
  new Map(model.links.map((link) => [link.key, link]))

describe('map session navigation model', () => {
  it('adds start/manage and join lobby entry points for local map mode', () => {
    const model = buildMapSessionNavigationModel({
      mapSlug: 'training yard',
      sessionModeEnabled: false,
    })
    const links = linkMap(model)

    expect(model.heading).toBe('Table session')
    expect(model.statusLabel).toContain('Local map mode is unchanged')
    expect(links.get('start-manage-session')).toMatchObject({
      label: 'Start/manage session',
      to: '/sessions#gm-lobby-title',
      kind: 'lobby',
    })
    expect(links.get('join-session')).toMatchObject({
      label: 'Join session',
      to: '/sessions#player-lobby-title',
      kind: 'lobby',
    })
    expect(links.get('open-session-map')).toMatchObject({
      label: 'Open session map',
      to: '/maps/training%20yard?session=1',
      kind: 'map',
    })
    expect(links.has('open-local-map')).toBe(false)
  })

  it('links back to the local map route when session mode is already active', () => {
    const model = buildMapSessionNavigationModel({
      mapSlug: 'folder/name',
      sessionModeEnabled: true,
    })
    const links = linkMap(model)

    expect(model.statusLabel).toContain('Session mode active')
    expect(links.get('open-local-map')).toMatchObject({
      label: 'Return to local map',
      to: '/maps/folder%2Fname',
      kind: 'map',
    })
    expect(links.has('open-session-map')).toBe(false)
  })

  it('omits map-mode links when no map slug is available but keeps lobby shortcuts', () => {
    const model = buildMapSessionNavigationModel({ mapSlug: '   ' })
    const links = linkMap(model)

    expect(links.get('start-manage-session')?.to).toBe('/sessions#gm-lobby-title')
    expect(links.get('join-session')?.to).toBe('/sessions#player-lobby-title')
    expect(links.has('open-session-map')).toBe(false)
    expect(links.has('open-local-map')).toBe(false)
  })
})
