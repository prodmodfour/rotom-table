import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { ProjectedBaseAbilityInput } from '../abilityAutomation/effectiveAbilities'
import { resolveSheetAbilityInstances, abilityRequiresInstanceParameters } from '../abilityAutomation/instanceParameters'
import { resolvedSheetEdgeInstances } from '#shared/edgeAutomation/sheetEdges'
import { pokeEdgeAbilityGrants } from '#shared/edgeAutomation/grants'
import { findAbility, findMove } from '~~/data/ptuReference'
import { edgeChoiceValues } from '#shared/edgeAutomation/instances'
import { resolveEffectiveEdges } from './effectiveEdges'

export interface EdgePermanentGrant {
  readonly canonicalId: string
  readonly sourceCanonicalId: string
  readonly edgeInstanceId: string
  readonly definitionHash: string
}

const permanentGrants = (
  sheet: CharacterSheet | TrainerSheet,
  propertyId: 'move' | 'ability',
): readonly EdgePermanentGrant[] => {
  const family = 'species' in sheet ? 'poke' as const : 'trainer' as const
  const effective = resolveEffectiveEdges({ ownerId: sheet.slug, family, sheet })
  const grants = effective.instances.flatMap(instance => instance.effective
    ? instance.mechanics.flatMap(mechanic => {
        if (mechanic.kind !== 'permanent-grant' || mechanic.propertyId !== propertyId) return []
        const values = mechanic.value === 'choice' && mechanic.choiceId
          ? edgeChoiceValues(instance.instance, mechanic.choiceId)
          : typeof mechanic.value === 'string' ? [mechanic.value] : []
        return values.map(canonicalId => Object.freeze({
          canonicalId,
          sourceCanonicalId: instance.canonicalId,
          edgeInstanceId: instance.instanceId,
          definitionHash: instance.definitionHash,
        }))
      }) : [])
  return Object.freeze([...new Map(grants.map(grant => [`${grant.edgeInstanceId}:${grant.canonicalId}`, grant])).values()])
}

export const resolveSheetEdgeMoveGrants = (
  sheet: CharacterSheet | TrainerSheet,
): readonly EdgePermanentGrant[] => Object.freeze(permanentGrants(sheet, 'move')
  .filter(grant => Boolean(findMove(grant.canonicalId))))

export const resolveSheetEdgeAbilityGrants = (
  sheet: CharacterSheet | TrainerSheet,
): readonly EdgePermanentGrant[] => Object.freeze(permanentGrants(sheet, 'ability')
  .filter(grant => Boolean(findAbility(grant.canonicalId))))

/** Virtual, provenance-bound Ability grants; sheet rows are never browser-manufactured. */
export const resolveSheetAndEdgeAbilityInstances = (
  sheet: CharacterSheet | TrainerSheet,
): readonly ProjectedBaseAbilityInput[] => {
  const base = resolveSheetAbilityInstances(sheet.abilities)
  if (!('species' in sheet)) return base
  const grants = resolvedSheetEdgeInstances(sheet, 'poke').flatMap(instance => (
    pokeEdgeAbilityGrants(instance).flatMap((canonicalId, index): readonly ProjectedBaseAbilityInput[] => {
      if (!findAbility(canonicalId)) return []
      return [Object.freeze({
        instanceId: `${instance.instanceId}:ability:${index}`,
        canonicalId,
        parameterStatus: abilityRequiresInstanceParameters(canonicalId) ? 'missing-required-data' : 'not-parameterized',
        parameterData: null,
      })]
    })
  ))
  const byId = new Map([...base, ...grants].map(instance => [instance.instanceId, instance]))
  return Object.freeze([...byId.values()])
}

export interface EdgeGrantedMove {
  readonly entry: CharacterSheetMove
  readonly edgeInstanceId: string
  readonly canonicalId: string
}

export const resolvePokeEdgeMoveGrants = (
  sheet: Pick<CharacterSheet, 'slug' | 'edges'>,
): readonly EdgeGrantedMove[] => Object.freeze(resolveSheetEdgeMoveGrants(sheet as CharacterSheet).flatMap(grant => {
  const move = findMove(grant.canonicalId)
  return move ? [Object.freeze({
    entry: Object.freeze({ name: move.name }),
    edgeInstanceId: grant.edgeInstanceId,
    canonicalId: grant.sourceCanonicalId,
  })] : []
}))
