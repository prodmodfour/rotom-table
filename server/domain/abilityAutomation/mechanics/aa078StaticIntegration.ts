import { createHash } from 'node:crypto'
import {
  AA078_LIGHTNING_KICKS_MARK_ID,
  AA078_LIQUID_VOICE_DB1_MARK_ID,
  AA078_LIQUID_VOICE_MARK_ID,
  AA078_LONG_REACH_BRANCH_ID,
  AA078_MAELSTROM_PULSE_MARK_ID,
  aa078OwnedMarks,
} from '#shared/abilityAutomation/aa078'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import { applyCombatStageToStat } from '~/utils/combatStageStats'
import { moveAutomationTargetBranches } from '~/utils/moveAutomationTargetBranches'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveDamageTypeResolution } from '../../moveAutomation/damageTypes'
import { aa071ResistDamageType } from './aa071StaticIntegration'

export const AA078_LONG_REACH_TARGETING_OVERRIDE = Object.freeze({
  kind: 'single-target' as const,
  minTargets: 1,
  maxTargets: 1,
  selector: { kind: 'selected-targets' as const },
})

type Aa078AbilityStateContext = Pick<AuthoritativeMoveRulesContext, 'map'> & {
  readonly actor: Pick<AuthoritativeMoveRulesContext['actor'], 'placement'>
  readonly queries: Pick<AuthoritativeMoveRulesContext['queries'], 'abilities'>
}

const activeInstances = (
  context: Aa078AbilityStateContext,
  canonicalId: string,
): ReadonlySet<string> => new Set(context.queries.abilities
  .activeForPlacement(context.actor.placement.id)
  .filter(ability => ability.canonicalId === canonicalId)
  .map(ability => ability.instanceId))

const activeMarks = (input: {
  readonly context: Aa078AbilityStateContext
  readonly canonicalId: 'Lightning Kicks' | 'Liquid Voice' | 'Maelstrom Pulse'
  readonly markIds: ReadonlySet<string>
}) => aa078OwnedMarks({
  entries: input.context.map.encounterState?.abilityOwnedState?.entries,
  ownerPlacementId: input.context.actor.placement.id,
  canonicalId: input.canonicalId,
  markIds: input.markIds,
  activeAbilityInstanceIds: activeInstances(input.context, input.canonicalId),
})

const baseReviewedScript = (
  context: AuthoritativeMoveRulesContext,
  script: Pick<MoveAutomationScript, 'moveName' | 'keywords' | 'type'>,
): Pick<MoveAutomationScript, 'moveName' | 'keywords' | 'type'> => (
  context.queries.rules.reviewedScriptFor(script.moveName) ?? script
)

export const aa078LightningKicksActiveForMove = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'moveName'>
}): boolean => /kick/i.test(input.script.moveName)
  && activeMarks({
    context: input.context,
    canonicalId: 'Lightning Kicks',
    markIds: new Set([AA078_LIGHTNING_KICKS_MARK_ID]),
  }).length > 0

export const aa078MaelstromPulseActiveForMove = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'moveName' | 'type' | 'keywords'>
}): boolean => baseReviewedScript(input.context, input.script).type.trim().toLowerCase() === 'water'
  && activeMarks({
    context: input.context,
    canonicalId: 'Maelstrom Pulse',
    markIds: new Set([AA078_MAELSTROM_PULSE_MARK_ID]),
  }).length > 0

export const aa078LiquidVoiceModeForMove = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'moveName' | 'keywords' | 'type'>
}): { readonly active: boolean; readonly statusDamage: boolean } => {
  const base = baseReviewedScript(input.context, input.script)
  if (!base.keywords.some(keyword => keyword.trim().toLowerCase() === 'sonic')) {
    return Object.freeze({ active: false, statusDamage: false })
  }
  const marks = activeMarks({
    context: input.context,
    canonicalId: 'Liquid Voice',
    markIds: new Set([AA078_LIQUID_VOICE_MARK_ID, AA078_LIQUID_VOICE_DB1_MARK_ID]),
  })
  return Object.freeze({
    active: marks.length > 0,
    statusDamage: marks.some(entry => entry.payload.kind === 'mark'
      && entry.payload.markId === AA078_LIQUID_VOICE_DB1_MARK_ID),
  })
}

export const aa078LongReachSelected = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'damaging'>
  readonly targetBranchId?: string
}): boolean => input.targetBranchId === AA078_LONG_REACH_BRANCH_ID
  && input.script.damaging
  && input.context.queries.abilities.has(input.context.actor.placement.id, 'Long Reach')

/** Server-projected declaration script for Long Reach and armed Liquid Voice. */
export const aa078MovePresentationScript = (input: {
  readonly context: Aa078AbilityStateContext
  readonly script: MoveAutomationScript
  readonly qualificationScript?: Pick<MoveAutomationScript, 'keywords' | 'damageClass'>
}): MoveAutomationScript => {
  const qualificationScript = input.qualificationScript ?? input.script
  const liquidVoiceMarks = qualificationScript.keywords.some(keyword => keyword.trim().toLowerCase() === 'sonic')
    ? activeMarks({
        context: input.context,
        canonicalId: 'Liquid Voice',
        markIds: new Set([AA078_LIQUID_VOICE_MARK_ID, AA078_LIQUID_VOICE_DB1_MARK_ID]),
      })
    : []
  const liquidVoice = {
    active: liquidVoiceMarks.length > 0,
    statusDamage: liquidVoiceMarks.some(entry => entry.payload.kind === 'mark'
      && entry.payload.markId === AA078_LIQUID_VOICE_DB1_MARK_ID),
  }
  const liquidScript: MoveAutomationScript = liquidVoice.active
    ? {
        ...input.script,
        type: 'Water',
        keywords: [
          ...input.script.keywords.filter(keyword => keyword.trim().toLowerCase() !== 'sonic'),
          ...(input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'friendly')
            ? [] : ['Friendly']),
        ],
        ...(liquidVoice.statusDamage && qualificationScript.damageClass === 'Status'
          ? { damaging: true, damageClass: 'Special', damageBase: 1 }
          : {}),
        automationNotes: [...new Set([...input.script.automationNotes, 'Ability: Liquid Voice'])],
      }
    : input.script
  if (!liquidScript.damaging
    || !input.context.queries.abilities.has(input.context.actor.placement.id, 'Long Reach')) {
    return liquidScript
  }
  const branches = moveAutomationTargetBranches(liquidScript)
  return {
    ...liquidScript,
    targetBranches: [
      ...branches,
      ...(branches.some(branch => branch.id === AA078_LONG_REACH_BRANCH_ID) ? [] : [{
        id: AA078_LONG_REACH_BRANCH_ID,
        label: 'Long Reach — 8, 1 Target',
        targetMode: 'one-target' as const,
        targetCount: 1,
        range: '8, 1 Target',
        areaTemplates: [],
      }]),
    ],
  }
}

export const aa078MoveAccuracyBonus = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'moveName'>
}): 0 | 4 => aa078LightningKicksActiveForMove(input) ? 4 : 0

export const aa078MovePriorityActive = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'moveName' | 'type' | 'keywords'>
}): boolean => aa078LightningKicksActiveForMove(input)
  || aa078MaelstromPulseActiveForMove(input)

export const aa078StateIdsForMove = (
  context: AuthoritativeMoveRulesContext,
  script: Pick<MoveAutomationScript, 'moveName' | 'type' | 'keywords'>,
): readonly string[] => {
  const states = [
    ...(aa078LightningKicksActiveForMove({ context, script })
      ? activeMarks({ context, canonicalId: 'Lightning Kicks', markIds: new Set([AA078_LIGHTNING_KICKS_MARK_ID]) })
      : []),
    ...(aa078LiquidVoiceModeForMove({ context, script }).active
      ? activeMarks({ context, canonicalId: 'Liquid Voice', markIds: new Set([AA078_LIQUID_VOICE_MARK_ID, AA078_LIQUID_VOICE_DB1_MARK_ID]) })
      : []),
    ...(aa078MaelstromPulseActiveForMove({ context, script })
      ? activeMarks({ context, canonicalId: 'Maelstrom Pulse', markIds: new Set([AA078_MAELSTROM_PULSE_MARK_ID]) })
      : []),
  ]
  return Object.freeze([...new Set(states.map(entry => entry.stateId))])
}

export const aa078LiquidOozeDamageTypeOverlay = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientId: string
  readonly resolved: MoveDamageTypeResolution
}): MoveDamageTypeResolution => input.resolved.moveType.trim().toLowerCase() === 'poison'
  && input.context.queries.abilities.has(input.recipientId, 'Liquid Ooze')
  ? aa071ResistDamageType({ resolved: input.resolved, steps: 1, sources: ['Liquid Ooze'] })
  : input.resolved

export const aa078LightningRodBlocksElectric = (input: {
  readonly context: AuthoritativeMoveRulesContext | undefined
  readonly recipientId: string
  readonly moveType: string | null
}): boolean => input.moveType?.trim().toLowerCase() === 'electric'
  && input.context?.queries.abilities.has(input.recipientId, 'Lightning Rod') === true

export const aa078MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveType: string
}): readonly MoveDamageModifier[] => {
  const modifiers: MoveDamageModifier[] = []
  const type = input.moveType.trim().toLowerCase()
  const maximumHp = Math.max(1, input.actor.fullMaxHp ?? input.actor.maxHp)
  if (type === 'flying'
    && Math.max(0, input.actor.currentHp) * 3 <= maximumHp) {
    for (const [index, ability] of input.context.queries.abilities.activeForPlacement(input.actor.id)
      .filter(candidate => candidate.canonicalId === 'Mach Speed').entries()) {
      modifiers.push({
        id: `ability.mach-speed.last-chance.${createHash('sha256').update(`${input.operation.id}\u0000${input.recipient.id}\u0000${ability.instanceId}`).digest('hex').slice(0, 24)}`,
        stage: 'pre-type-modifiers', priority: 39 + index,
        source: { kind: 'ability', id: ability.instanceId },
        stackingGroup: `aa078-mach-speed:${ability.instanceId}`,
        reasonCode: 'ability.mach-speed.last-chance', operation: 'add', value: 5,
      })
    }
  }
  if (aa078MaelstromPulseActiveForMove({
    context: input.context,
    script: { moveName: input.context.intent.moveName, type: input.moveType, keywords: [] },
  })) {
    const speed = applyCombatStageToStat(input.actor.spd, input.actor.combatStages?.spd)
    modifiers.push({
      id: `ability.maelstrom-pulse.damage.${createHash('sha256').update(`${input.operation.id}\u0000${input.recipient.id}`).digest('hex').slice(0, 24)}`,
      stage: 'pre-type-modifiers', priority: 44,
      source: { kind: 'ability', id: 'Maelstrom Pulse' },
      stackingGroup: 'aa078-maelstrom-pulse',
      reasonCode: 'ability.maelstrom-pulse.half-speed-damage',
      operation: 'add', value: Math.floor(speed / 2),
    })
  }
  return Object.freeze(modifiers)
}
