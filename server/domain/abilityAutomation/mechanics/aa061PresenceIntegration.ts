import { createHash } from 'node:crypto'
import { parseEncounterState, createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { resolveSheetAbilityInstances } from '../instanceParameters'
import { reduceAbilityOwnedStateCommand } from '../ownedState'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY, type AbilityAutomationRuntimeRegistry } from '../registry'

const shortHash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)

export const aa061BallFetchReleaseMarkId = (releasedPlacementId: string): string => (
  `aa061.ball-fetch.release:${shortHash(releasedPlacementId)}`
)

export const hasAa061BallFetchResponse = (input: {
  readonly map: TabletopMap
  readonly ownerPlacementId: string
  readonly abilityInstanceId: string
}): boolean => (input.map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => (
  entry.ownerPlacementId === input.ownerPlacementId
  && entry.sourceAbilityInstanceId === input.abilityInstanceId
  && entry.canonicalId === 'Ball Fetch'
  && entry.payload.kind === 'mark'
  && entry.payload.markId.startsWith('aa061.ball-fetch.release:')
))

/**
 * Materialize one retry-safe Ball Fetch response mark for every effective,
 * already-present owner after an authoritative send-out transition.
 */
export const applyAa061BallFetchSendOutTriggers = (input: {
  readonly mapBefore: TabletopMap
  readonly mapAfter: TabletopMap
  readonly releasedPlacementId: string
  readonly operationId: string
  readonly readPokemonSheet: (slug: string) => CharacterSheet | null
  readonly registry?: AbilityAutomationRuntimeRegistry
}): TabletopMap => {
  const runtime = (input.registry ?? ABILITY_AUTOMATION_RUNTIME_REGISTRY).resolve('Ball Fetch')
  if (!runtime) return input.mapAfter
  let encounter = parseEncounterState(input.mapAfter.encounterState ?? createEmptyEncounterState())
  for (const placement of input.mapBefore.placements) {
    if (placement.id === input.releasedPlacementId || placement.sheetKind !== 'pokemon') continue
    const sheet = input.readPokemonSheet(placement.sheetSlug)
    if (!sheet) continue
    const abilities = projectAuthoritativeEffectiveAbilities({
      baseAbilities: resolveSheetAbilityInstances(sheet.abilities),
      target: {
        placementId: placement.id,
        ...(placement.sideId ? { sideId: placement.sideId } : {}),
        position: placement.position,
      },
      effects: input.mapAfter.encounterState?.effects ?? [],
      transformationSnapshots: input.mapAfter.encounterState?.abilityTransformations,
    })
    const source = abilities.find(ability => (
      ability.effective
      && ability.canonicalId === 'Ball Fetch'
      && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash)
    ))
    if (!source) continue
    const identity = shortHash(`${input.operationId}:${placement.id}:${input.releasedPlacementId}`)
    const stateId = `${source.instanceId}:ball-fetch:${identity}`
    const result = reduceAbilityOwnedStateCommand(encounter.abilityOwnedState, {
      operationId: `${input.operationId}:ball-fetch:${identity}`,
      kind: 'create', stateId, expectedVersion: null,
      entry: {
        stateId,
        ownerPlacementId: placement.id,
        sourceAbilityInstanceId: source.instanceId,
        canonicalId: 'Ball Fetch',
        targetPlacementIds: [input.releasedPlacementId],
        lifecycle: { kind: 'target-presence', targetPolicy: 'any-target-leaves' },
        payload: { kind: 'mark', markId: aa061BallFetchReleaseMarkId(input.releasedPlacementId) },
      },
    })
    encounter = parseEncounterState({ ...encounter, abilityOwnedState: result.state })
  }
  return { ...input.mapAfter, encounterState: encounter }
}
