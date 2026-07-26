import { createHash } from 'node:crypto'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import {
  createEmptyAbilityDailyUsageLedger,
  parseAbilityDailyUsageLedger,
  type AbilityUsageEntry,
} from '#shared/abilityAutomation/resources'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect, type EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { PokemonTypeId } from '#shared/pokemonTypes'
import { AA077_LEAFY_CLOAK_EFFECT_TAG } from '#shared/abilityAutomation/aa077'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import { normalizeCombatStages } from '~/utils/combatStages'
import { normalizeConditionName } from '~/utils/statusConditions'
import {
  computePokemonHealingVitals,
  computeTrainerHealingVitals,
  healPokemonHp,
  healTrainerHp,
  removePokemonInjuries,
  removeTrainerInjuries,
} from '~/utils/sheets/healing'
import { deepCloneJson } from '~/utils/serialization'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import type { AuthoritativeAbilityContext } from '../context'
import { planAbilityFrequencyPayment } from '../usage'

const SCENE_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
})

const DISCIPLINE_CONDITIONS = new Set(['Confused', 'Flinch', 'Rage', 'Infatuation'])
const STAGE_BY_STAT = Object.freeze({
  attack: 'atk', defense: 'def', 'special-attack': 'satk',
  'special-defense': 'sdef', speed: 'spd',
} satisfies Record<string, CombatStageKey>)

export class Aa067ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa067ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa067ActivatedExecutionError(detail) }

const selectedValues = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): readonly AbilityDeclarationOptionValue[] => choices.find(choice => choice.declarationId === declarationId)?.options.map(option => option.value) ?? []

const currentEncounter = (plan: MoveStateChangePlan, fallback: unknown) => {
  const change = plan.changes.find(entry => entry.kind === 'encounter-state')
  return parseEncounterState(change?.kind === 'encounter-state' ? change.current : fallback)
}

const mapWithEncounter = (
  context: AuthoritativeAbilityContext,
  encounter: unknown,
): AuthoritativeAbilityContext => ({
  ...context,
  map: { ...context.map, encounterState: parseEncounterState(encounter) },
})

const actionPlan = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly resource: 'swift' | 'free'
}) => planEncounterMoveResourceCosts({
  map: input.context.map,
  placementId: input.context.actor.placement.id,
  canonicalMoveId: `ability:${input.canonicalId}`,
  moveKey: `ability:${input.canonicalId.toLowerCase().replaceAll(' ', '-')}`,
  range: `${input.resource[0]!.toUpperCase()}${input.resource.slice(1)} Action`,
  resolutionId: input.context.resolutionId,
  sourceOperationId: `${input.operationId}:action`,
  movement: null,
  reviewedCosts: [{
    id: `ability.action.${input.resource}`, phase: 'pay',
    cost: { kind: 'action-resource', resource: input.resource, amount: 1 },
  }],
  allowLegacyFallback: false,
  minimumPhaseExclusive: null,
  maximumPhaseInclusive: 'pay',
})

const payScene = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly resource: 'swift' | 'free'
}) => {
  const action = actionPlan(input)
  const frequencyContext = mapWithEncounter(input.context, action.currentEncounterState)
  const frequency = planAbilityFrequencyPayment({
    context: frequencyContext,
    frequency: SCENE_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId,
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: frequencyContext.map.encounterState?.history.sceneId ?? undefined,
  })
  return currentEncounter(frequency.plan, action.currentEncounterState)
}

const encounterChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly reasonCode: string
  readonly current: unknown
}): MoveStateChangeInput => ({
  kind: 'encounter-state',
  scope: { kind: 'encounter', mapSlug: input.context.map.slug },
  expectedRevision: normalizeRevision(input.context.map.revision),
  sourceOperationId: input.operationId,
  reasonCode: input.reasonCode,
  previous: parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState()),
  current: parseEncounterState(input.current),
  compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
})

const sheetChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly previous: AnyLiveSheet
  readonly current: AnyLiveSheet
  readonly changedFields: readonly ('hp' | 'conditions' | 'combatStages' | 'abilityUsage')[]
  readonly reasonCode: string
}): MoveStateChangeInput => {
  const current = deepCloneJson(input.current) as AnyLiveSheet
  current.revision = nextRevision(input.context.actor.sheet.revision)
  return {
    kind: 'sheet-state',
    scope: {
      kind: 'sheet', sheetKind: input.context.actor.sheet.kind,
      sheetSlug: input.context.actor.sheet.slug,
    },
    expectedRevision: input.context.actor.sheet.revision,
    sourceOperationId: input.operationId,
    reasonCode: input.reasonCode,
    previous: input.previous,
    current,
    changedFields: input.changedFields,
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }
}

const usageIdentity = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly abilityInstanceId: string
}): Pick<AbilityUsageEntry, 'ownerId' | 'abilityInstanceId' | 'canonicalId' | 'clauseId'> => {
  const ability = input.context.actor.effectiveAbilities.find(candidate => (
    candidate.effective
    && candidate.instanceId === input.abilityInstanceId
    && candidate.canonicalId === 'Defy Death'
  )) ?? fail('Defy Death ability instance is no longer effective.')
  return {
    ownerId: `sheet:${input.context.actor.sheet.kind}:${input.context.actor.sheet.slug}`,
    abilityInstanceId: ability.sourceKind === 'base' ? 'base:Defy Death' : ability.instanceId,
    canonicalId: 'Defy Death',
    clauseId: 'injuries',
  }
}

const sameUsageIdentity = (
  entry: AbilityUsageEntry,
  identity: Pick<AbilityUsageEntry, 'ownerId' | 'abilityInstanceId' | 'canonicalId' | 'clauseId'>,
): boolean => entry.ownerId === identity.ownerId
  && entry.abilityInstanceId === identity.abilityInstanceId
  && entry.canonicalId === identity.canonicalId
  && entry.clauseId === identity.clauseId

const defyDeathExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa067ActivatedExecution => {
  const branch = selectedValues(input.choices, 'activate.injury-count')[0]
  const match = branch?.kind === 'branch' ? /^remove-([1-3])$/.exec(branch.branchId) : null
  const requested = match ? Number(match[1]) : fail('Defy Death requires one issued Injury-count choice.')
  const previous = deepCloneJson(input.context.actor.sheet.sheet) as AnyLiveSheet
  const current = deepCloneJson(previous) as AnyLiveSheet
  const vitals = input.context.actor.sheet.kind === 'pokemon'
    ? computePokemonHealingVitals(current as CharacterSheet)
    : computeTrainerHealingVitals(current as TrainerSheet)
  const identity = usageIdentity(input)
  const ledger = parseAbilityDailyUsageLedger(current.abilityUsage ?? createEmptyAbilityDailyUsageLedger())
  const existing = ledger.entries.find(entry => sameUsageIdentity(entry, identity))
  const remaining = Math.max(0, 3 - (existing?.spent ?? 0))
  if (requested > vitals.injuries || requested > remaining) {
    fail('Defy Death cannot remove that many Injuries from the current authoritative state.')
  }
  const operationIds = Array.from({ length: requested }, (_, index) => `${input.operationId}:injury-${index + 1}`)
  if (operationIds.some(operationId => ledger.entries.some(entry => entry.operationIds.includes(operationId)))) {
    fail('Defy Death Injury payment operation was already consumed.')
  }
  const usage: AbilityUsageEntry = {
    ...identity, limit: 3, spent: (existing?.spent ?? 0) + requested,
    operationIds: [...(existing?.operationIds ?? []), ...operationIds],
  }
  current.abilityUsage = parseAbilityDailyUsageLedger({
    schemaVersion: 1,
    dayKey: ledger.dayKey ?? 'campaign-day:initial',
    entries: existing
      ? ledger.entries.map(entry => entry === existing ? usage : entry)
      : [...ledger.entries, usage],
  })
  const removed = input.context.actor.sheet.kind === 'pokemon'
    ? removePokemonInjuries(current as CharacterSheet, requested, { countAgainstDailyLimit: false })
    : removeTrainerInjuries(current as TrainerSheet, requested, { countAgainstDailyLimit: false })
  if (removed !== requested) fail('Defy Death Injury removal was unexpectedly limited.')
  const tick = Math.max(1, Math.floor(vitals.fullMaxHp / 10))
  if (input.context.actor.sheet.kind === 'pokemon') healPokemonHp(current as CharacterSheet, tick * removed)
  else healTrainerHp(current as TrainerSheet, tick * removed)
  const action = actionPlan({
    context: input.context, operationId: input.operationId,
    canonicalId: 'Defy Death', resource: 'swift',
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([
      encounterChange({
        context: input.context, operationId: input.operationId,
        reasonCode: 'ability.aa067.defy-death.action-paid',
        current: action.currentEncounterState,
      }),
      sheetChange({
        context: input.context, operationId: `${input.operationId}:sheet`, previous, current,
        changedFields: ['hp', 'abilityUsage'], reasonCode: 'ability.aa067.defy-death.healed',
      }),
    ]),
    presentationKey: 'ability.aa067.defy-death.applied',
  })
}

const designerExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa067ActivatedExecution => {
  const types = selectedValues(input.choices, 'activate.types').map(value => (
    value.kind === 'type' ? value.typeId : fail('Designer requires issued Type choices.')
  ))
  if (types.length !== 2 || new Set(types).size !== 2) fail('Designer requires exactly two distinct Types.')
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  const retained = previous.effects.filter(effect => !(
    effect.affected.placementIds.includes(input.context.actor.placement.id)
    && (
      (
        effect.kind === 'capability'
        && effect.tags.includes('aa067')
        && effect.tags.includes('designer')
      )
      || effect.tags.includes(AA077_LEAFY_CLOAK_EFFECT_TAG)
    )
  ))
  const suffix = createHash('sha256').update(`${input.operationId}:${types.join(':')}`).digest('hex').slice(0, 20)
  const effects: EncounterEffect[] = types.map((typeId: PokemonTypeId, index) => parseEncounterEffect({
    id: `ability.designer.${typeId}.${suffix}.${index + 1}`,
    kind: 'capability',
    source: { operationId: input.operationId, moveId: 'ability.designer', placementId: input.context.actor.placement.id },
    affected: { placementIds: [input.context.actor.placement.id], sideIds: [], cells: [] },
    createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
    createdTurn: previous.history.currentTurn?.turn ?? 0,
    duration: { kind: 'until-triggered', remaining: null },
    stacks: 1, charges: null,
    stackPolicy: { kind: 'replace', maxStacks: null },
    chargePolicy: { kind: 'none', amount: null },
    tags: ['ability', 'aa067', 'designer', `type.${typeId}`],
    payload: { capabilityId: `aa067.designer.resistance.${typeId}`, action: 'grant', value: 1 },
    dispel: { policy: 'matching-tags', tags: ['designer'] },
    transferPolicy: 'retain', suppression: { sources: [] },
  }, `ability.designer.effects[${index}]`))
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      context: input.context, operationId: input.operationId,
      reasonCode: 'ability.aa067.designer.suit-replaced',
      current: parseEncounterState({ ...previous, effects: [...retained, ...effects] }),
    })]),
    presentationKey: 'ability.aa067.designer.applied',
  })
}

const disciplineExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa067ActivatedExecution => {
  if (input.context.map.encounterState?.history.currentTurn?.placementId !== input.context.actor.placement.id
    || input.context.map.encounterState.history.actedThisRoundPlacementIds.includes(input.context.actor.placement.id)) {
    fail('Discipline may be used only immediately after the user gains initiative.')
  }
  const previous = deepCloneJson(input.context.actor.sheet.sheet) as AnyLiveSheet
  const retained = input.context.actor.token.conditions.filter(condition => {
    const canonical = normalizeConditionName(condition)
    return canonical === null || !DISCIPLINE_CONDITIONS.has(canonical)
  })
  if (retained.length === input.context.actor.token.conditions.length) {
    fail('Discipline has no eligible current condition to cure.')
  }
  const current = applyConditionsToSheet(input.context.actor.sheet.kind, previous, retained)
  const encounter = payScene({
    context: input.context, operationId: input.operationId,
    abilityInstanceId: input.abilityInstanceId, canonicalId: 'Discipline', resource: 'free',
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([
      encounterChange({
        context: input.context, operationId: input.operationId,
        reasonCode: 'ability.aa067.discipline.paid', current: encounter,
      }),
      sheetChange({
        context: input.context, operationId: `${input.operationId}:conditions`, previous, current,
        changedFields: ['conditions'], reasonCode: 'ability.aa067.discipline.cured',
      }),
    ]),
    presentationKey: 'ability.aa067.discipline.applied',
  })
}

const effectiveDefensiveStat = (
  context: AuthoritativeAbilityContext,
  targetId: string,
  stat: 'defense' | 'special-defense',
): number => context.queries.stats.resolve(targetId, {
  stat,
  combatStagePolicy: 'honor',
  stageModifierPolicy: 'honor',
})?.value ?? fail(`Download target has no authoritative ${stat} Stat.`)

const downloadExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa067ActivatedExecution => {
  const target = selectedValues(input.choices, 'activate.target')[0]
  const targetId = target?.kind === 'token' ? target.placementId : fail('Download requires one issued target.')
  if (!input.context.queries.tokens.get(targetId)) fail('Download target disappeared.')
  const defense = effectiveDefensiveStat(input.context, targetId, 'defense')
  const specialDefense = effectiveDefensiveStat(input.context, targetId, 'special-defense')
  let stage: CombatStageKey
  if (defense < specialDefense) stage = 'atk'
  else if (specialDefense < defense) stage = 'satk'
  else {
    const tie = selectedValues(input.choices, 'activate.tie-stat')[0]
    stage = tie?.kind === 'stat'
      ? STAGE_BY_STAT[tie.statId as keyof typeof STAGE_BY_STAT]
        ?? fail('Download tie choice must be a non-HP combat Stat.')
      : fail('Download requires a Stat choice when the target defenses are tied.')
  }
  if (defense !== specialDefense && selectedValues(input.choices, 'activate.tie-stat').length > 0) {
    fail('Download does not accept a tie Stat when the target defenses are unequal.')
  }
  const previous = deepCloneJson(input.context.actor.sheet.sheet) as AnyLiveSheet
  const stages: CombatStageMap = {
    ...normalizeCombatStages(input.context.actor.token.combatStages),
    [stage]: Math.min(6, normalizeCombatStages(input.context.actor.token.combatStages)[stage] + 1),
  }
  const current = applyCombatStagesToSheet(input.context.actor.sheet.kind, previous, stages)
  const encounter = payScene({
    context: input.context, operationId: input.operationId,
    abilityInstanceId: input.abilityInstanceId, canonicalId: 'Download', resource: 'swift',
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([
      encounterChange({
        context: input.context, operationId: input.operationId,
        reasonCode: 'ability.aa067.download.paid', current: encounter,
      }),
      sheetChange({
        context: input.context, operationId: `${input.operationId}:stage`, previous, current,
        changedFields: ['combatStages'], reasonCode: `ability.aa067.download.raise-${stage}`,
      }),
    ]),
    presentationKey: defense === specialDefense
      ? 'ability.aa067.download.tie'
      : defense < specialDefense
        ? 'ability.aa067.download.attack'
        : 'ability.aa067.download.special-attack',
  })
}

export interface Aa067ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa067ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa067ActivatedExecution | null => {
  if (input.context.runtime.canonicalId === 'Defy Death' && input.operation.mechanicId === 'aa067.defy-death') {
    return defyDeathExecution(input)
  }
  if (input.context.runtime.canonicalId === 'Designer' && input.operation.mechanicId === 'aa067.designer') {
    return designerExecution(input)
  }
  if (input.context.runtime.canonicalId === 'Discipline' && input.operation.mechanicId === 'aa067.discipline') {
    return disciplineExecution(input)
  }
  if (input.context.runtime.canonicalId === 'Download' && input.operation.mechanicId === 'aa067.download') {
    return downloadExecution(input)
  }
  return null
}
