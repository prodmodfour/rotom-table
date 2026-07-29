import type { CharacterSheet } from '~/types/characterSheet'
import { resolveNature } from '~/utils/ptuNatures'
import { pokemonHasResolvedCapability } from '~/utils/sheets/pokemonDerived'
import { deepCloneJson } from '~/utils/serialization'
import {
  type MarsupialRelationshipResolution,
  withoutMarsupialPouchState,
} from './marsupialRelationship'

export class CapabilityEvolutionRuleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CapabilityEvolutionRuleError'
  }
}

export const splitEvolutionTarget = (sheet: CharacterSheet): 'Silcoon' | 'Cascoon' | null => {
  if (!pokemonHasResolvedCapability(sheet, 'Split Evolution')) return null
  const raised = resolveNature(sheet.nature)?.plus
  if (!raised) return null
  return raised === 'atk' || raised === 'satk' || raised === 'spd' ? 'Silcoon' : 'Cascoon'
}

export const deltaEvolutionNeedsMegaStone = (
  sheet: CharacterSheet,
  hasEffectiveDeltaEvolution: boolean = pokemonHasResolvedCapability(sheet, 'Delta Evolution'),
): boolean => {
  const rayquaza = sheet.species.trim().toLocaleLowerCase('en-US').includes('rayquaza')
  const dragonAscent = [...(sheet.movelist ?? []), ...(sheet.appliedMoves ?? [])]
    .some(move => move.name.trim().toLocaleLowerCase('en-US') === 'dragon ascent')
  return !(rayquaza && dragonAscent && hasEffectiveDeltaEvolution)
}

export interface CapabilityEvolutionTransition {
  readonly sheet: CharacterSheet
  readonly producedHeldItem: 'Pink Pearl' | null
  readonly reasonCodes: readonly string[]
}

/** Apply source-owned evolution triggers to one server-authoritative sheet transition. */
export const applyCapabilityEvolutionTransition = (
  previous: CharacterSheet,
  requested: CharacterSheet,
  options: { readonly marsupialRelationship?: MarsupialRelationshipResolution } = {},
): CapabilityEvolutionTransition => {
  if (options.marsupialRelationship?.status === 'corrupt') {
    throw new CapabilityEvolutionRuleError(
      options.marsupialRelationship.reasonCode,
      options.marsupialRelationship.message,
    )
  }
  const next = deepCloneJson(requested)
  const reasons: string[] = []
  const evolved = previous.species.trim().toLocaleLowerCase('en-US') !== next.species.trim().toLocaleLowerCase('en-US')
  if (evolved && pokemonHasResolvedCapability(previous, 'Split Evolution')) {
    const required = splitEvolutionTarget(previous)
    if (!required) throw new CapabilityEvolutionRuleError('split-evolution-nature-missing', 'Split Evolution requires a canonical Nature.')
    if (next.species.trim().toLocaleLowerCase('en-US') !== required.toLocaleLowerCase('en-US')) {
      throw new CapabilityEvolutionRuleError('split-evolution-target-invalid', `This Nature requires evolution into ${required}.`)
    }
    reasons.push('capability.split-evolution.applied')
  }
  let producedHeldItem: 'Pink Pearl' | null = null
  if (evolved && pokemonHasResolvedCapability(previous, 'Pearl Creation')) {
    const displacedHeld = next.items?.held?.trim()
    next.items = {
      ...(next.items ?? {}),
      held: 'Pink Pearl',
      ...(displacedHeld ? { extraItems: [...(next.items?.extraItems ?? []), displacedHeld] } : {}),
    }
    if (next.capabilities?.other) {
      next.capabilities = {
        ...next.capabilities,
        other: next.capabilities.other.filter(label => label.trim().toLocaleLowerCase('en-US') !== 'pearl creation'),
      }
    }
    producedHeldItem = 'Pink Pearl'
    reasons.push('capability.pearl-creation.applied')
  }
  if ((next.level ?? 0) < 25 && pokemonHasResolvedCapability(next, 'Marsupial')) {
    if (next.babyTemplate !== true) reasons.push('capability.marsupial.baby-template-applied')
    next.babyTemplate = true
  }
  else if ((next.level ?? 0) >= 25
    && (pokemonHasResolvedCapability(previous, 'Marsupial') || pokemonHasResolvedCapability(next, 'Marsupial'))
    && next.babyTemplate === true) {
    next.babyTemplate = false
    const cleared = withoutMarsupialPouchState(next)
    if (cleared.capabilityCampaignState) next.capabilityCampaignState = cleared.capabilityCampaignState
    else delete next.capabilityCampaignState
    reasons.push('capability.marsupial.baby-template-ended')
  }
  return Object.freeze({ sheet: next, producedHeldItem, reasonCodes: Object.freeze(reasons) })
}
