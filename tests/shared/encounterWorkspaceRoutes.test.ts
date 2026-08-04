import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENCOUNTER_WORKSPACE_FEATURE_POLICY,
  battlefieldWorkshopPath,
  encounterLibraryPath,
  encounterTacticalPath,
  encounterWorkspacePath,
  resolveLivePlayEntryPath,
} from '../../shared/encounterWorkspace/routes'
import {
  sortEncounterWorkspaceSummaries,
  summarizeMapBackedEncounter,
} from '../../shared/encounterWorkspace/library'
import { createItemChoiceMap } from '../fixtures/moveAutomation/itemChoices'

describe('encounter workspace routes and map-backed summaries', () => {
  it('keeps explicit workspace and compatibility workshop paths independently addressable', () => {
    expect(encounterLibraryPath()).toBe('/play')
    expect(encounterWorkspacePath('Viridian Arena')).toBe('/play/Viridian%20Arena')
    expect(encounterTacticalPath('Viridian Arena')).toBe('/play/Viridian%20Arena/tactical')
    expect(battlefieldWorkshopPath('Viridian Arena')).toBe('/maps/Viridian%20Arena')
    expect(resolveLivePlayEntryPath({ mapSlug: 'arena' })).toBe('/maps/arena')
    expect(resolveLivePlayEntryPath({ mapSlug: 'arena', explicitWorkspaceOptIn: true })).toBe('/play/arena')
    expect(resolveLivePlayEntryPath({
      mapSlug: 'arena',
      policy: { ...DEFAULT_ENCOUNTER_WORKSPACE_FEATURE_POLICY, defaultForLivePlay: true },
    })).toBe('/play/arena')
    expect(resolveLivePlayEntryPath({
      mapSlug: 'arena',
      explicitWorkspaceOptIn: true,
      policy: { ...DEFAULT_ENCOUNTER_WORKSPACE_FEATURE_POLICY, enabled: false },
    })).toBe('/maps/arena')
  })

  it('derives live, ready, and empty summaries without introducing encounter-document authority', () => {
    const base = createItemChoiceMap()
    const empty = summarizeMapBackedEncounter({ ...base, slug: 'empty', name: 'Empty', placements: [], updatedAt: 1 })
    const ready = summarizeMapBackedEncounter({ ...base, slug: 'ready', name: 'Ready', initiative: undefined, activeScene: null, updatedAt: 2 })
    const live = summarizeMapBackedEncounter({
      ...base,
      slug: 'live',
      name: 'Live',
      activeScene: { name: 'Finale', startedAt: 3 },
      initiative: { activeId: 'item-choice-actor', round: 3 },
      updatedAt: 3,
    })
    expect(empty).toMatchObject({ state: 'empty', participantCount: 0, scene: { active: false } })
    expect(ready).toMatchObject({ state: 'ready', participantCount: 2 })
    expect(live).toMatchObject({ state: 'live', round: 3, currentParticipantId: 'item-choice-actor', scene: { name: 'Finale' } })
    expect(sortEncounterWorkspaceSummaries([empty, ready, live]).map(value => value.state)).toEqual(['live', 'ready', 'empty'])
  })
})
