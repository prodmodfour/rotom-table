import { describe, expect, it } from 'vitest'
import { buildPlayerSessionMapNavigationModel } from '~/utils/playerSessionMapNavigation'

describe('player session map navigation model', () => {
  it('builds session-mode links for visible attached maps with the selected map first', () => {
    const model = buildPlayerSessionMapNavigationModel({
      selectedMapAttached: true,
      currentMapVisible: true,
      currentMapAvailable: true,
      currentMap: {
        mapSlug: 'training yard',
        revision: 4,
        selected: true,
        attached: true,
        availableForSessionMode: true,
      },
      visibleMapSlugs: ['side-room', 'training yard'],
      visibleMaps: [
        {
          mapSlug: 'side-room',
          revision: 2,
          selected: false,
          attached: true,
          availableForSessionMode: true,
        },
        {
          mapSlug: 'training yard',
          revision: 4,
          selected: true,
          attached: true,
          availableForSessionMode: true,
        },
      ],
    })

    expect(model.status).toBe('ready')
    expect(model.emptyMessage).toBeNull()
    expect(model.links).toHaveLength(2)
    expect(model.links[0]).toMatchObject({
      label: 'Open selected session map',
      mapSlug: 'training yard',
      to: '/maps/training%20yard?session=1',
      selected: true,
      revisionLabel: 'map revision 4',
    })
    expect(model.links[1]).toMatchObject({
      label: 'Open session map',
      mapSlug: 'side-room',
      to: '/maps/side-room?session=1',
      selected: false,
    })
    expect(model.summary).toContain('session mode')
    expect(model.summary).toContain('session commands')
  })

  it('falls back to visible map slugs when the player state has no detailed map summaries yet', () => {
    const model = buildPlayerSessionMapNavigationModel({
      selectedMapAttached: true,
      currentMapVisible: true,
      currentMapAvailable: true,
      currentMap: {
        mapSlug: 'folder/name',
        selected: true,
        attached: true,
        availableForSessionMode: true,
      },
      visibleMapSlugs: ['folder/name'],
      visibleMaps: [],
    })

    expect(model.status).toBe('ready')
    expect(model.links).toEqual([
      expect.objectContaining({
        label: 'Open selected session map',
        mapSlug: 'folder/name',
        to: '/maps/folder%2Fname?session=1',
        selected: true,
      }),
    ])
  })

  it('explains that the GM needs to attach a map when no session map is attached', () => {
    const model = buildPlayerSessionMapNavigationModel({
      selectedMapAttached: false,
      currentMapVisible: false,
      currentMapAvailable: false,
      currentMap: null,
      visibleMapSlugs: [],
      visibleMaps: [],
    })

    expect(model.status).toBe('needs-session-map')
    expect(model.links).toEqual([])
    expect(model.summary).toBe('No session map is attached to this live session yet.')
    expect(model.emptyMessage).toContain('The GM needs to attach a saved map')
  })

  it('explains that the GM needs to make the attached map visible when the player has no visible maps', () => {
    const model = buildPlayerSessionMapNavigationModel({
      selectedMapAttached: true,
      currentMapVisible: false,
      currentMapAvailable: false,
      currentMap: null,
      visibleMapSlugs: [],
      visibleMaps: [],
    })

    expect(model.status).toBe('needs-player-visibility')
    expect(model.links).toEqual([])
    expect(model.summary).toContain('not visible to your player')
    expect(model.emptyMessage).toContain('Ask the GM to make the attached session map visible')
  })

  it('shows a loading state before a joined player state is available', () => {
    const model = buildPlayerSessionMapNavigationModel(null)

    expect(model.status).toBe('loading')
    expect(model.links).toEqual([])
    expect(model.emptyMessage).toContain('lists attached session maps')
  })
})
