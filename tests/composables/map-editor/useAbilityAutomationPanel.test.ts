import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAbilityAutomationPanel } from '~/composables/map-editor/useAbilityAutomationPanel'
import { parseAbilityClientCapabilityBundle } from '#shared/abilityAutomation/clientCapabilities'
import type {
  AbilityClientDeclarationOffer,
  BeginAbilityClientDeclarationCommand,
} from '#shared/abilityAutomation/clientCommands'
import type { AbilityDeclarationIntent } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityResolutionPublicResult } from '#shared/abilityAutomation/results'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena-map',
  name: 'Arena',
  revision: 4,
  dimensions: { x: 8, y: 2, z: 8 },
  voxels: [],
  placements: [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor-sheet', position: { x: 0, y: 0, z: 0 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target-sheet', position: { x: 2, y: 0, z: 0 } },
  ],
})
const actorSheet = (): CharacterSheet => ({
  schemaVersion: 1,
  slug: 'actor-sheet',
  name: 'Actor',
  revision: 1,
  abilities: [{ name: 'Abominable' }],
} as unknown as CharacterSheet)
const targetSheet = (): CharacterSheet => ({
  schemaVersion: 1,
  slug: 'target-sheet',
  name: 'Target',
  revision: 1,
  abilities: [],
} as unknown as CharacterSheet)
const spawned = (): SpawnedPokemon[] => [
  { id: 'actor', species: 'Actor' },
  { id: 'target', species: 'Target' },
] as SpawnedPokemon[]
const capability = (overrides: Record<string, unknown> = {}) => ({
  instanceId: 'base:actor:0',
  canonicalId: 'Abominable',
  displayName: 'Abominable',
  effective: true,
  baseStatus: 'complete',
  interactionStatus: 'unassessed',
  status: 'ready',
  statusBadgeKey: 'ability.status.ready',
  unavailableReasonCode: null,
  modes: [{ modeId: 'activate', kind: 'activated', invocable: true, targeting: [] }],
  ...overrides,
})
const bundle = (overrides: Record<string, unknown> = {}) => parseAbilityClientCapabilityBundle({
  schemaVersion: 1,
  mapSlug: 'arena-map',
  mapRevision: 4,
  placements: [{ placementId: 'actor', abilities: [capability()] }],
  ...overrides,
})
const offer = (declarations: AbilityClientDeclarationOffer['declarations'] = []): AbilityClientDeclarationOffer => ({
  schemaVersion: 1,
  offerId: 'offer:1',
  offerSha256: 'a'.repeat(64),
  mapSlug: 'arena-map',
  mapRevision: 4,
  expiresAt: 10_000,
  actorPlacementId: 'actor',
  abilityInstanceId: 'base:actor:0',
  canonicalId: 'Abominable',
  modeId: 'activate',
  declarations,
})
const accepted = (operationId = 'intent:2'): AbilityResolutionPublicResult => ({
  schemaVersion: 1,
  kind: 'accepted',
  operationId,
  resolutionId: 'resolution:1',
  mapSlug: 'arena-map',
  previousRevision: 4,
  revision: 5,
  status: 'committed',
  presentation: { key: 'ability.resolution.completed', outcome: 'applied' },
})
const harness = (input: {
  capabilities?: ReturnType<typeof bundle>
  begin?: (command: BeginAbilityClientDeclarationCommand) => Promise<unknown>
  resolve?: (intent: AbilityDeclarationIntent) => Promise<unknown>
  ids?: string[]
} = {}) => {
  const map = ref<TabletopMap | null>(mapFixture())
  const begin = vi.fn(input.begin ?? (async () => offer()))
  const resolve = vi.fn(input.resolve ?? (async () => accepted()))
  const ids = [...(input.ids ?? ['request:1', 'intent:2', 'retry:3'])]
  const panel = useAbilityAutomationPanel({
    map,
    spawnedPokemon: computed(spawned),
    pokemonBySlug: ref(new Map([['actor-sheet', actorSheet()], ['target-sheet', targetSheet()]])),
    trainerBySlug: ref(new Map<string, TrainerSheet>()),
    capabilities: ref(input.capabilities ?? bundle()),
    canControlPlacement: id => id === 'actor',
    beginDeclaration: begin,
    resolveDeclaration: resolve,
    idFactory: () => ids.shift() ?? 'fallback:1',
  })
  return { map, begin, resolve, panel }
}
const reference = { id: 'actor', abilityInstanceId: 'base:actor:0', canonicalId: 'Abominable' }

describe('native ability automation panel boundary', () => {
  it('drives menu status solely from the revision-bound server capability', () => {
    const { panel } = harness()
    expect(panel.tokenAbilityOptionsById.value.actor).toEqual([
      expect.objectContaining({
        instanceId: 'base:actor:0',
        canonicalId: 'Abominable',
        capability: expect.objectContaining({ status: 'ready' }),
      }),
    ])

    const stale = harness({ capabilities: bundle({ mapRevision: 3 }) })
    expect(stale.panel.tokenAbilityOptionsById.value.actor[0]?.capability).toBeNull()
  })

  it('requests a declaration by stable runtime identity and auto-submits a no-choice mode', async () => {
    const { panel, begin, resolve } = harness()
    await expect(panel.openAbilityAutomation(reference)).resolves.toBe(true)
    expect(begin).toHaveBeenCalledWith({
      schemaVersion: 1,
      requestId: 'request:1',
      mapSlug: 'arena-map',
      baseRevision: 4,
      actorPlacementId: 'actor',
      abilityInstanceId: 'base:actor:0',
      canonicalId: 'Abominable',
      modeId: 'activate',
    })
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 1,
      intentId: 'intent:2',
      offerId: 'offer:1',
      selections: [],
    }))
    expect(panel.abilityInvocationStatus.value).toMatchObject({ kind: 'accepted' })
  })

  it('uses only server-issued placement hints for map targeting', async () => {
    const targetOffer = offer([{
      declarationId: 'target',
      kind: 'token',
      minSelections: 1,
      maxSelections: 1,
      options: [{
        optionId: 'target:allowed',
        presentationKey: 'ability.target.allowed',
        hint: { kind: 'placement', placementId: 'target' },
      }],
    }])
    const begin = vi.fn().mockResolvedValue(targetOffer)
    const resolve = vi.fn().mockResolvedValue(accepted())
    const { panel } = harness({ begin, resolve })

    expect(await panel.openAbilityAutomation(reference)).toBe(true)
    expect(panel.abilityAutomationTargeting.value?.candidateIds).toEqual(['target'])
    expect(await panel.selectAbilityAutomationTarget('not-issued')).toBe(false)
    expect(await panel.selectAbilityAutomationTarget('target')).toBe(true)
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      selections: [{ declarationId: 'target', kind: 'token', optionIds: ['target:allowed'] }],
    }))
  })

  it('requires an explicit choice when a runtime exposes multiple activated modes', async () => {
    const capabilities = bundle({
      placements: [{
        placementId: 'actor',
        abilities: [capability({ modes: [
          { modeId: 'first', kind: 'activated', invocable: true, targeting: [] },
          { modeId: 'second', kind: 'activated', invocable: true, targeting: [] },
        ] })],
      }],
    })
    const secondOffer = { ...offer(), modeId: 'second' }
    const begin = vi.fn().mockResolvedValue(secondOffer)
    const { panel } = harness({ capabilities, begin })

    expect(await panel.openAbilityAutomation(reference)).toBe(true)
    expect(begin).not.toHaveBeenCalled()
    expect(panel.activeAbilityModeSelection.value?.modes.map(mode => mode.modeId)).toEqual(['first', 'second'])
    expect(await panel.selectAbilityMode('second')).toBe(true)
    expect(begin).toHaveBeenCalledWith(expect.objectContaining({ modeId: 'second' }))
  })

  it('does not invoke passive, blocked, suppressed, or unissued abilities', async () => {
    for (const status of ['passive', 'blocked', 'suppressed', 'parameters-required', 'runtime-drift'] as const) {
      const effective = status !== 'suppressed'
      const capabilities = bundle({
        placements: [{ placementId: 'actor', abilities: [capability({
          effective,
          status,
          statusBadgeKey: `ability.status.${status}`,
          unavailableReasonCode: status === 'passive' ? null : `ability.unavailable.${status}`,
          modes: status === 'passive'
            ? [{ modeId: 'static', kind: 'static', invocable: false, targeting: [] }]
            : [{ modeId: 'activate', kind: 'activated', invocable: true, targeting: [] }],
        })] }],
      })
      const { panel, begin } = harness({ capabilities })
      await expect(panel.openAbilityAutomation(reference)).resolves.toBe(false)
      expect(begin).not.toHaveBeenCalled()
    }
  })

  it('retains the exact intent for uncertain retry rather than rebuilding selections', async () => {
    const resolve = vi.fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(accepted('intent:2'))
    const { panel } = harness({ resolve })
    expect(await panel.openAbilityAutomation(reference)).toBe(false)
    expect(panel.abilityInvocationStatus.value).toMatchObject({ kind: 'uncertain', intentId: 'intent:2' })
    expect(await panel.retryAbilityDeclaration()).toBe(true)
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(resolve.mock.calls[1]?.[0]).toBe(resolve.mock.calls[0]?.[0])
  })
})
