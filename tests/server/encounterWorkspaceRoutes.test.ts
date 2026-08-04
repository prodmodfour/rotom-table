import { describe, expect, it } from 'vitest'
import { listEncounterWorkspacesUseCase } from '../../server/useCases/listEncounterWorkspaces'
import { resolveEncounterWorkspaceAudience } from '../../server/useCases/loadEncounterWorkspace'
import { createItemChoiceMap } from '../fixtures/moveAutomation/itemChoices'
import { createEncounterDocument, parseEncounterDocument } from '#shared/encounterDocuments/model'

const rows = () => {
  const base = createItemChoiceMap()
  return [{
    slug: 'private-live',
    revision: 9,
    updatedAt: 90,
    document: {
      ...base,
      slug: 'ignored-document-slug',
      name: 'Private live encounter',
      playerVisible: false,
      activeScene: { name: 'Private scene', startedAt: 80 },
      initiative: { activeId: 'item-choice-actor', round: 4 },
    },
  }, {
    slug: 'shared-ready',
    revision: 3,
    updatedAt: 30,
    document: {
      ...base,
      slug: 'shared-ready',
      name: 'Shared ready encounter',
      playerVisible: true,
      activeScene: null,
      initiative: { activeId: null, round: 0, manualOrderIds: [] },
    },
  }]
}

describe('encounter workspace route use cases', () => {
  it('lists map-backed encounter summaries with role visibility and repository revisions', () => {
    const mapRepository = { list: rows }
    const gm = listEncounterWorkspacesUseCase({ role: 'gm' }, { mapRepository })
    const player = listEncounterWorkspacesUseCase({ role: 'player' }, { mapRepository })
    expect(gm.summaries.map(value => value.mapSlug)).toEqual(['private-live', 'shared-ready'])
    expect(gm.summaries[0]).toMatchObject({ state: 'live', revision: 9, round: 4 })
    expect(player.summaries.map(value => value.mapSlug)).toEqual(['shared-ready'])
    expect(player.summaries[0]).toMatchObject({ playerVisible: true, state: 'ready' })
  })

  it('discovers first-class documents by encounter identity without duplicating their linked compatibility map', () => {
    const mapRows = rows()
    const placementId = mapRows[1]!.document.placements[0]!.id
    const base = createEncounterDocument({
      encounterId: 'canal-ambush', name: 'Canal Ambush', linkedMapSlug: 'shared-ready', recipe: 'ambush', now: 20,
    })
    const document = parseEncounterDocument({
      ...base,
      lifecycle: 'active',
      revision: 4,
      updatedAt: 40,
      hiddenParticipantIds: [placementId],
      castRoles: [{ participantId: placementId, role: 'leader' }],
    })
    const dependencies = {
      mapRepository: { list: () => mapRows },
      encounterRepository: { list: () => [document] },
    }
    const gm = listEncounterWorkspacesUseCase({ role: 'gm' }, dependencies)
    const player = listEncounterWorkspacesUseCase({ role: 'player' }, dependencies)

    expect(gm.summaries.map(summary => summary.encounterId)).toEqual(['private-live', 'canal-ambush'])
    expect(gm.summaries[1]).toMatchObject({
      documentBacked: true, encounterId: 'canal-ambush', mapSlug: 'shared-ready', name: 'Canal Ambush',
      encounterRevision: 4, recipe: 'ambush', lifecycle: 'active',
    })
    expect(player.summaries).toHaveLength(1)
    expect(player.summaries[0]).toMatchObject({ encounterId: 'canal-ambush', participantCount: mapRows[1]!.document.placements.length - 1 })
  })

  it('allows diagnostic/public modes only through role-bounded audience resolution', () => {
    expect(resolveEncounterWorkspaceAudience('gm', undefined)).toBe('gm')
    expect(resolveEncounterWorkspaceAudience('gm', 'diagnostic')).toBe('diagnostic')
    expect(resolveEncounterWorkspaceAudience('gm', 'public')).toBe('public')
    expect(resolveEncounterWorkspaceAudience('player', 'diagnostic')).toBe('player-owner')
    expect(resolveEncounterWorkspaceAudience('player', 'gm')).toBe('player-owner')
    expect(resolveEncounterWorkspaceAudience('player', 'public')).toBe('public')
  })
})
