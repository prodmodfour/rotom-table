import { createHash } from 'node:crypto'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import { clampCombatStage } from '~/utils/combatStages'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { resolveStats } from '~/utils/sheets/pokemonDerived'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { parseMoveAutomationAreaTemplates } from '~/utils/moveAutomationAreaTemplates'
import {
  POKEMON_TYPES,
  computeMultiplier,
  resistMultiplierOneStepFurther,
} from '~/utils/typeChart'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveDamageTypeResolution } from '../../moveAutomation/damageTypes'

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const ability = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
  canonicalId: string,
): string | null => context.queries.abilities.activeForPlacement(placementId)
  .find(candidate => candidate.canonicalId === canonicalId)?.instanceId ?? null

const hasWeather = (
  context: AuthoritativeMoveRulesContext,
  kind: 'hail' | 'rainy' | 'sandstorm' | 'sunny',
): boolean => context.queries.weather.active().some(weather => weather.kind === kind)

const activeEffect = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
  tag: string,
): boolean => context.map.encounterState?.effects.some(effect => (
  effect.tags.includes(tag)
  && effect.affected.placementIds.includes(placementId)
  && effect.suppression.sources.length === 0
  && (effect.duration.remaining === null || effect.duration.remaining > 0)
)) === true

/** Remaining-catalog Base Stat, default-stage, form, and weather projections. */
export const aa085to100AdjustedToken = (input: {
  readonly token: SpawnedPokemon
  readonly sheet: CharacterSheet | null
  readonly effectiveAbilityIds: readonly string[]
  readonly contextMap: AuthoritativeMoveRulesContext['map']
}): SpawnedPokemon => {
  const abilities = new Set(input.effectiveAbilityIds)
  let token = input.token
  if (abilities.has('RKS System')) {
    const memoryType = token.tokenItems.flatMap(item => {
      const match = item.trim().match(/^(Bug|Dark|Dragon|Electric|Fairy|Fighting|Fire|Flying|Ghost|Grass|Ground|Ice|Normal|Poison|Psychic|Rock|Steel|Water) Memory(?: Disc)?$/i)
      return match?.[1]
        ? [match[1][0]!.toUpperCase() + match[1].slice(1).toLowerCase()]
        : []
    })[0]
    if (memoryType) token = { ...token, defenderTypes: [memoryType] }
  }
  if (abilities.has('Pure Power') && input.sheet) {
    const baseAttack = resolveStats(input.sheet).find(stat => stat.key === 'atk')?.base ?? 0
    token = { ...token, atk: token.atk + Math.max(0, baseAttack) }
  }
  if (abilities.has('Sorcery')) {
    token = { ...token, satk: token.satk + 5 + Math.floor(Math.max(0, token.level) / 10) }
  }
  if (abilities.has('Unburden')) {
    const holdingItem = token.tokenItems.some(item => item.trim().length > 0)
    token = {
      ...token,
      combatStages: {
        ...token.combatStages,
        spd: clampCombatStage(token.combatStages.spd + (holdingItem ? 0 : 2)),
      },
    }
  }
  const sunny = (input.contextMap.fieldEffects?.weather ?? []).some(weather => weather.kind === 'sunny')
  if (abilities.has('Thermosensitive') && sunny) {
    token = {
      ...token,
      combatStages: {
        ...token.combatStages,
        atk: clampCombatStage(token.combatStages.atk + 2),
        satk: clampCombatStage(token.combatStages.satk + 2),
      },
    }
  }
  const hailing = (input.contextMap.fieldEffects?.weather ?? []).some(weather => weather.kind === 'hail')
  if (abilities.has('Thermosensitive') && hailing && token.movementCapabilities) {
    token = {
      ...token,
      movementCapabilities: Object.fromEntries(Object.entries(token.movementCapabilities)
        .map(([kind, value]) => [kind, typeof value === 'number'
          ? Math.max(1, Math.floor(value / 2))
          : value])),
    }
  }
  const actorEffects = input.contextMap.encounterState?.effects ?? []
  const hasEffectTag = (tag: string): boolean => actorEffects.some(effect => (
    effect.tags.includes(tag)
    && effect.affected.placementIds.includes(token.id)
    && effect.suppression.sources.length === 0
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
  ))
  if (abilities.has('Run Away') && token.conditions.some(condition => condition === 'Trapped')) {
    token = { ...token, conditions: token.conditions.filter(condition => condition !== 'Trapped') }
  }
  if (hasEffectTag('aa089-shadow-tag')) {
    token = { ...token, conditions: [...new Set([...token.conditions, 'Slowed', 'Trapped'])] }
  }
  if (hasEffectTag('aa086-regal-challenge-deference')) {
    token = { ...token, conditions: [...new Set([...token.conditions, 'Stuck'])] }
  }
  if (token.movementCapabilities && hasEffectTag('aa088-shackle-half-movement')) {
    token = {
      ...token,
      movementCapabilities: Object.fromEntries(Object.entries(token.movementCapabilities)
        .map(([kind, value]) => [kind, typeof value === 'number'
          ? Math.max(1, Math.floor(value / 2)) : value])),
    }
  }
  if (token.movementCapabilities && hasEffectTag('aa091-spray-down-grounded')) {
    token = {
      ...token,
      movementCapabilities: {
        ...token.movementCapabilities,
        sky: 0,
        levitate: 0,
      },
    }
  }
  const schoolingForm = abilities.has('Schooling') && actorEffects.some(effect => (
    effect.tags.includes('aa088-schooling')
    && effect.affected.placementIds.includes(token.id)
    && effect.suppression.sources.length === 0
  ))
  const schoolingMaximum = Math.max(1, token.fullMaxHp ?? token.maxHp)
  const schoolingTemporaryHp = input.contextMap.temporaryHitPoints?.byPlacementId[token.id] ?? 0
  if (schoolingForm && (token.currentHp * 2 >= schoolingMaximum || schoolingTemporaryHp > 0)) token = {
    ...token,
    atk: token.atk + 12,
    def: token.def + 11,
    satk: token.satk + 11,
    sdef: token.sdef + 10,
    ...(typeof token.spd === 'number' ? { spd: Math.max(1, token.spd - 1) } : {}),
  }
  const shieldsDownCore = abilities.has('Shields Down')
    && token.currentHp * 2 <= Math.max(1, token.fullMaxHp ?? token.maxHp)
  if (shieldsDownCore) token = {
    ...token,
    atk: token.atk + 4,
    def: Math.max(1, token.def - 4),
    satk: token.satk + 4,
    sdef: Math.max(1, token.sdef - 4),
    ...(typeof token.spd === 'number' ? { spd: token.spd + 6 } : {}),
    creatureRules: token.creatureRules ? { ...token.creatureRules, formId: 'minior-core' } : token.creatureRules,
  }
  const zenMode = actorEffects.some(effect => (
    effect.tags.includes('aa100-zen-mode')
    && effect.affected.placementIds.includes(token.id)
    && effect.suppression.sources.length === 0
  ))
  const zenSnowed = actorEffects.some(effect => (
    effect.tags.includes('aa100-zen-snowed')
    && effect.affected.placementIds.includes(token.id)
    && effect.suppression.sources.length === 0
  ))
  if (zenMode) token = {
    ...token,
    atk: Math.max(1, token.atk - 11), def: token.def + 5,
    satk: token.satk + 11, sdef: token.sdef + 5,
    ...(typeof token.spd === 'number' ? { spd: Math.max(1, token.spd - 4) } : {}),
    defenderTypes: ['Fire', 'Psychic'],
  }
  else if (zenSnowed) token = {
    ...token,
    atk: token.atk + 2,
    ...(typeof token.spd === 'number' ? { spd: token.spd + 4 } : {}),
    defenderTypes: ['Ice', 'Fire'],
  }
  const swordStance = abilities.has('Stance Change') && actorEffects.some(effect => (
    effect.tags.includes('aa092-stance-change-sword')
    && effect.affected.placementIds.includes(token.id)
    && effect.suppression.sources.length === 0
  ))
  if (swordStance) token = {
    ...token,
    atk: token.def,
    def: token.atk,
    satk: token.sdef,
    sdef: token.satk,
  }
  const slowStart = abilities.has('Slow Start') && (
    (input.contextMap.initiative?.round ?? 1) <= 3
    || actorEffects.some(effect => (
      effect.tags.includes('aa089-slow-start')
      && effect.affected.placementIds.includes(token.id)
      && effect.suppression.sources.length === 0
      && (effect.duration.remaining === null || effect.duration.remaining > 0)
    ))
  )
  if (slowStart) token = {
    ...token,
    atk: Math.max(1, Math.floor(token.atk / 2)),
    ...(typeof token.spd === 'number' ? { spd: Math.max(1, Math.floor(token.spd / 2)) } : {}),
  }
  return token
}

/** Authoritative declaration-shape overrides for reviewed static range abilities. */
export const aa085to100MovePresentationScript = (input: {
  readonly context: Pick<AuthoritativeMoveRulesContext, 'actor' | 'queries'>
  readonly script: MoveAutomationScript
}): MoveAutomationScript => {
  const actorId = input.context.actor.placement.id
  const name = input.script.moveName.trim().toLowerCase()
  let script = input.script
  if (input.context.queries.abilities.has(actorId, 'Sonic Courtship') && name === 'attract') {
    const range = 'Burst 3, Sonic, Friendly'
    script = {
      ...script,
      range,
      keywords: [...new Set([...script.keywords, 'Sonic', 'Friendly'])],
      targetMode: 'multi-target', targetCount: null,
      areaTemplates: parseMoveAutomationAreaTemplates(range),
      automationNotes: [...new Set([...script.automationNotes, `Ability range override: ${range}`])],
    }
  }
  if (input.context.queries.abilities.has(actorId, 'Trinity') && name === 'tri attack') {
    script = {
      ...script, range: 'Melee, 3 Targets', targetMode: 'multi-target', targetCount: 3,
      areaTemplates: [],
      automationNotes: [...new Set([...script.automationNotes, 'Trinity: Melee, 3 Targets'])],
    }
  }
  if (input.context.queries.abilities.has(actorId, 'Wily')
    && script.damageClass?.trim().toLowerCase() === 'status'
    && script.targetCount !== null && script.targetCount > 0) {
    script = {
      ...script,
      targetMode: 'multi-target', targetCount: script.targetCount + 1,
      automationNotes: [...new Set([...script.automationNotes, 'Wily: +1 target'])],
    }
  }
  let range: string | null = null
  if (input.context.queries.abilities.has(actorId, 'Radiant Beam')
    && script.damaging && script.type.trim().toLowerCase() === 'grass') range = 'Line 4'
  else if (input.context.queries.abilities.has(actorId, 'Spike Shot')
    && /^melee\s*,?\s*1[ -]?target$/i.test(script.range.trim())) range = '8, 1 Target'
  else if (input.context.queries.abilities.has(actorId, 'Whirlwind Kicks')
    && ['rapid spin', 'triple kick'].includes(name)) range = 'Burst 1'
  if (!range) return script
  const areaTemplates = parseMoveAutomationAreaTemplates(range)
  return {
    ...script,
    range,
    targetMode: areaTemplates.length > 0 ? 'multi-target' : 'one-target',
    targetCount: areaTemplates.length > 0 ? null : 1,
    areaTemplates,
    automationNotes: [...new Set([
      ...script.automationNotes,
      `Ability range override: ${range}`,
    ])],
  }
}

/** Triage makes Healing-keyword Moves resolve on the Priority lane. */
export const aa085to100MovePriorityActive = (input: {
  readonly context: Pick<AuthoritativeMoveRulesContext, 'actor' | 'queries'>
  readonly script: Pick<MoveAutomationScript, 'keywords'>
}): boolean => input.context.queries.abilities.has(input.context.actor.placement.id, 'Triage')
  && input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'healing')

const STRONG_JAW_MOVES = new Set([
  'bite', 'bug bite', 'crunch', 'fire fang', 'ice fang', 'thunder fang',
  'poison fang', 'hyper fang',
])
const RECKLESS_MOVES = new Set([
  'jump kick', 'hi jump kick', 'close combat', 'draco meteor', 'hammer arm',
  'leaf storm', 'outrage', 'overheat', 'petal dance', 'psycho boost',
  'superpower', 'thrash', 'v-create',
])

/** Exact post-bounds DB providers for remaining canonical abilities. */
export const aa085to100DamageBaseBonus = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'moveName' | 'damageBase' | 'range' | 'keywords'>
  readonly baseDamageBase: number
}): number => {
  const actorId = input.context.actor.placement.id
  const text = `${input.script.range} ${input.script.keywords.join(' ')}`.toLowerCase()
  let bonus = 0
  if (input.context.queries.abilities.has(actorId, 'Punk Rock') && /\bsonic\b/.test(text)) bonus += 2
  if (input.context.queries.abilities.has(actorId, 'Reckless')
    && (/\b(exhaust|recoil|reckless)\b/.test(text)
      || RECKLESS_MOVES.has(input.script.moveName.trim().toLowerCase()))) bonus += 3
  if (input.context.queries.abilities.has(actorId, 'Strong Jaw')
    && STRONG_JAW_MOVES.has(input.script.moveName.trim().toLowerCase())) bonus += 2
  if (input.context.queries.abilities.has(actorId, 'Technician')
    && (input.baseDamageBase <= 6 || /\b(double strike|five strike|fivestrike)\b/.test(text))) bonus += 2
  if (input.context.queries.abilities.has(actorId, 'Tough Claws') && /\bmelee\b/.test(text)) bonus += 2
  return bonus
}

const modifier = (input: {
  readonly operation: MoveDamageEffectOperation
  readonly recipientId: string
  readonly abilityInstanceId: string
  readonly group: string
  readonly reasonCode: string
  readonly value: number
  readonly stage?: MoveDamageModifier['stage']
  readonly priority?: number
}): MoveDamageModifier => ({
  id: `ability.remaining.${input.group}.${shortHash(
    input.operation.id, input.recipientId, input.abilityInstanceId,
  )}`,
  stage: input.stage ?? 'pre-type-modifiers',
  priority: input.priority ?? 48,
  source: { kind: 'ability', id: input.abilityInstanceId },
  stackingGroup: `remaining-${input.group}`,
  reasonCode: input.reasonCode,
  operation: input.value >= 0 ? 'add' : 'subtract',
  value: Math.abs(input.value),
})

const randomBonus = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly recipientId: string
  readonly canonicalId: string
  readonly count: number
  readonly sides: number
  readonly flat?: number
}): number => input.context.random.roll({
  rollId: `ability.${input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${shortHash(
    input.operation.id, input.recipientId,
  )}`,
  parentEffectId: input.operation.id,
  formula: { kind: 'dice', count: input.count, sides: input.sides, modifier: input.flat ?? 0 },
  reason: `${input.canonicalId} bonus damage`,
}).finalValue

const lastChanceType = (canonicalId: string): string | null => ({
  'Pure Blooded': 'dragon',
  Swarm: 'bug',
  Torrent: 'water',
  Unbreakable: 'steel',
  Venom: 'poison',
} as Readonly<Record<string, string>>)[canonicalId] ?? null

/** Damage Roll bonuses/reductions that require exact actor/recipient state. */
export const aa085to100MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly script: MoveAutomationScript
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveType: string
  readonly damageClass: 'physical' | 'special'
  readonly effectivenessMultiplier: number
  readonly critical: boolean
}): readonly MoveDamageModifier[] => {
  const result: MoveDamageModifier[] = []
  const actorId = input.actor.id
  const recipientId = input.recipient.id
  const add = (canonicalId: string, group: string, reasonCode: string, value: number): void => {
    const instanceId = ability(input.context, actorId, canonicalId)
    if (instanceId && value !== 0) result.push(modifier({
      operation: input.operation, recipientId, abilityInstanceId: instanceId,
      group, reasonCode, value,
    }))
  }
  const reduce = (canonicalId: string, group: string, reasonCode: string, value: number): void => {
    const instanceId = ability(input.context, recipientId, canonicalId)
    if (instanceId && value > 0) result.push(modifier({
      operation: input.operation, recipientId, abilityInstanceId: instanceId,
      group, reasonCode, value: -value, stage: 'post-damage-modifiers', priority: 52,
    }))
  }

  for (const canonicalId of ['Pure Blooded', 'Swarm', 'Torrent', 'Unbreakable', 'Venom']) {
    const type = lastChanceType(canonicalId)
    const maximum = Math.max(1, input.actor.fullMaxHp ?? input.actor.maxHp)
    if (type === input.moveType.toLowerCase() && input.actor.currentHp * 3 <= maximum) {
      add(canonicalId, `last-chance-${type}`, `ability.${canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.last-chance`, 5)
    }
  }

  if (input.actor.gender && input.recipient.gender
    && input.actor.gender.trim().toLowerCase() === input.recipient.gender.trim().toLowerCase()) {
    add('Rivalry', 'rivalry', 'ability.rivalry.same-gender-damage', 5)
  }
  const ledger = input.context.queries.resources.ledger(actorId)
  if (/\bmelee\b/i.test(input.script.range) && input.damageClass === 'physical' && ledger) {
    if (ledger.movement.spent >= 4 && input.context.queries.abilities.has(actorId, 'Rock Head')) {
      add('Rock Head', 'rock-head-charge', 'ability.rock-head.straight-line-charge', randomBonus({
        ...input, recipientId, canonicalId: 'Rock Head', count: 2, sides: 6,
      }))
    }
    if (ledger.movement.spent > 0) add(
      'Run Up', 'run-up', 'ability.run-up.straight-line-distance', ledger.movement.spent,
    )
  }
  if (input.context.queries.abilities.has(actorId, 'Sequence')
    && input.moveType.toLowerCase() === 'electric') {
    const adjacentElectric = input.context.queries.tokens.all().filter(token => (
      token.id !== actorId
      && token.defenderTypes.some(type => type.toLowerCase() === 'electric')
      && ptuGridDistanceBetweenFootprints(token, input.actor) <= 1
    )).length
    add('Sequence', 'sequence', 'ability.sequence.adjacent-electric-damage', adjacentElectric * 3)
  }
  if (input.critical && input.context.queries.abilities.has(actorId, 'Sniper')) {
    add('Sniper', 'sniper', 'ability.sniper.critical-damage', randomBonus({
      ...input, recipientId, canonicalId: 'Sniper', count: 3, sides: 10,
    }))
  }
  const entered = input.context.map.encounterState?.history.switchedPlacementIds.includes(recipientId)
    || input.context.map.encounterState?.history.switches.some(entry => entry.sentOutPlacementId === recipientId)
  if (entered) add('Stakeout', 'stakeout', 'ability.stakeout.recent-entry-damage', randomBonus({
    ...input, recipientId, canonicalId: 'Stakeout', count: 2, sides: 6, flat: 4,
  }))
  const auraProvider = input.context.queries.tokens.all().find(token => (
    (token.id === actorId
      || input.context.queries.relationships.resolve(token.id, actorId).relationship === 'ally')
    && input.context.queries.abilities.has(token.id, 'Type Aura')
    && token.defenderTypes[0]?.toLowerCase() === input.moveType.toLowerCase()
    && ptuGridDistanceBetweenFootprints(token, input.actor) <= 3
  ))
  const auraInstance = auraProvider
    ? ability(input.context, auraProvider.id, 'Type Aura')
    : null
  if (auraInstance) result.push(modifier({
    operation: input.operation, recipientId, abilityInstanceId: auraInstance,
    group: 'type-aura', reasonCode: 'ability.type-aura.damage', value: 5,
  }))
  if (input.context.queries.abilities.has(actorId, 'Twisted Power')) {
    add(
      'Twisted Power', 'twisted-power', 'ability.twisted-power.cross-stat-damage',
      Math.floor((input.damageClass === 'physical' ? input.actor.satk : input.actor.atk) / 2),
    )
  }
  if (input.context.queries.abilities.has(actorId, 'Weird Power')) {
    const value = input.damageClass === 'physical'
      ? input.actor.satk > input.actor.atk ? input.actor.satk : 0
      : input.actor.atk > input.actor.satk ? input.actor.atk : 0
    add('Weird Power', 'weird-power', 'ability.weird-power.higher-offense-damage', value)
  }
  if (normalizeConditionNames(input.actor.conditions).includes('Rage')) {
    add('White Flame', 'white-flame', 'ability.white-flame.enraged-damage', 5)
  }
  if (activeEffect(input.context, actorId, 'aa095-tingle-damage-penalty')) {
    const tingleInstance = input.context.map.encounterState?.effects.find(effect => (
      effect.tags.includes('aa095-tingle-damage-penalty')
      && effect.affected.placementIds.includes(actorId)
    ))?.source.operationId ?? 'ability.tingle'
    result.push(modifier({
      operation: input.operation, recipientId,
      abilityInstanceId: tingleInstance, group: 'tingle-penalty',
      reasonCode: 'ability.tingle.damage-penalty', value: -5,
    }))
  }
  if (activeEffect(input.context, actorId, 'aa086-regal-challenge-defiance')) {
    const regalInstance = input.context.map.encounterState?.effects.find(effect => (
      effect.tags.includes('aa086-regal-challenge-defiance')
      && effect.affected.placementIds.includes(actorId)
    ))?.source.operationId ?? 'ability.regal-challenge'
    result.push(modifier({
      operation: input.operation, recipientId,
      abilityInstanceId: regalInstance, group: 'regal-challenge-defiance',
      reasonCode: 'ability.regal-challenge.defiance-damage', value: 10,
    }))
  }
  if (hasWeather(input.context, 'sandstorm')
    && ['ground', 'rock', 'steel'].includes(input.moveType.toLowerCase())) {
    add('Sand Force', 'sand-force', 'ability.sand-force.damage', 5)
  }
  if (input.context.queries.abilities.has(actorId, 'Sheer Force')
    && /(?:effect range|\b(?:1[5-9]|20)\+)/i.test(input.script.effect)) {
    add('Sheer Force', 'sheer-force', 'ability.sheer-force.damage', 10)
  }
  const actorInitiative = input.context.queries.placements.get(actorId)?.initiative ?? undefined
  const recipientInitiative = input.context.queries.placements.get(recipientId)?.initiative ?? undefined
  if (actorInitiative !== undefined && recipientInitiative !== undefined
    && actorInitiative > recipientInitiative
    && !input.context.map.encounterState?.history.actedThisRoundPlacementIds.includes(recipientId)) {
    add('Vanguard', 'vanguard', 'ability.vanguard.unacted-lower-initiative-damage', 5)
  }

  if (input.effectivenessMultiplier > 1) reduce(
    'Solid Rock', 'solid-rock', 'ability.solid-rock.super-effective-reduction', 5,
  )
  if (hasWeather(input.context, 'sunny')) reduce(
    'Sol Veil', 'sol-veil', 'ability.sol-veil.sunny-damage-reduction', 5,
  )
  if (activeEffect(input.context, recipientId, 'aa089-slow-start')
    || (input.context.queries.abilities.has(recipientId, 'Slow Start')
      && (input.context.map.initiative?.round ?? 1) <= 3)) reduce(
    'Slow Start', 'slow-start', 'ability.slow-start.damage-reduction', 10,
  )
  if (activeEffect(input.context, recipientId, 'aa087-root-down-dr')) reduce(
    'Root Down', 'root-down', 'ability.root-down.damage-reduction', 5,
  )
  if (activeEffect(input.context, recipientId, 'aa093-suction-cups-dr')) reduce(
    'Suction Cups', 'suction-cups', 'ability.suction-cups.damage-reduction', 5,
  )
  const strategistEffect = input.context.map.encounterState?.effects.find(effect => (
    effect.tags.includes('aa096-type-strategist')
    && effect.affected.placementIds.includes(recipientId)
    && effect.suppression.sources.length === 0
  ))
  if (strategistEffect) {
    const maximum = Math.max(1, input.recipient.fullMaxHp ?? input.recipient.maxHp)
    reduce(
      'Type Strategist', 'type-strategist', 'ability.type-strategist.damage-reduction',
      input.recipient.currentHp * 3 < maximum ? 10 : 5,
    )
  }
  return Object.freeze(result)
}

const recomputeWithoutGhostImmunity = (
  moveType: string,
  defenderTypes: readonly string[],
): number => computeMultiplier(moveType, defenderTypes.filter(type => type.toLowerCase() !== 'ghost'))

/** Final type-provider ordering for Scrappy, lens/bypass abilities, and Wonder Guard. */
export const aa085to100DamageTypeOverlay = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientId: string
  readonly resolved: MoveDamageTypeResolution
}): MoveDamageTypeResolution => {
  const actorId = input.context.actor.placement.id
  const target = input.context.queries.tokens.get(input.recipientId)
  if (!target) return input.resolved
  let finalMultiplier = input.resolved.finalMultiplier
  let immunitySource = input.resolved.immunitySource
  const passiveSources = [...input.resolved.passiveSources]
  const moveType = input.resolved.moveType.toLowerCase()

  if (finalMultiplier === 0
    && ['normal', 'fighting'].includes(moveType)
    && target.defenderTypes.some(type => type.toLowerCase() === 'ghost')
    && input.context.queries.abilities.has(actorId, 'Scrappy')) {
    finalMultiplier = recomputeWithoutGhostImmunity(input.resolved.moveType, target.defenderTypes)
    immunitySource = null
    passiveSources.push('Scrappy')
  }
  if (finalMultiplier > 0 && finalMultiplier < 1
    && input.context.queries.abilities.has(actorId, 'Tinted Lens')) {
    finalMultiplier = Math.min(1, finalMultiplier * 2)
    passiveSources.push('Tinted Lens')
  }
  const typedBypass = (moveType === 'electric'
    && input.context.queries.abilities.has(actorId, 'Teravolt'))
    || (moveType === 'fire'
      && input.context.queries.abilities.has(actorId, 'Turboblaze'))
  if (typedBypass) {
    const typeChartMultiplier = computeMultiplier(input.resolved.moveType, target.defenderTypes)
    const defensiveImmunity = finalMultiplier === 0 && typeChartMultiplier > 0
    if (defensiveImmunity) {
      finalMultiplier = typeChartMultiplier
      immunitySource = null
    }
    if (finalMultiplier > 0 && finalMultiplier < 1) finalMultiplier = 1
    passiveSources.push(moveType === 'electric' ? 'Teravolt' : 'Turboblaze')
  }
  if (input.context.queries.abilities.has(input.recipientId, 'Shadow Shield')
    && target.currentHp >= Math.max(1, target.maxHp)
    && finalMultiplier > 0) {
    finalMultiplier = resistMultiplierOneStepFurther(finalMultiplier)
    passiveSources.push('Shadow Shield')
  }
  const wonderGuard = input.context.queries.abilities.has(input.recipientId, 'Wonder Guard')
    && !typedBypass
  if (wonderGuard) {
    const hasWeakness = POKEMON_TYPES.some(type => computeMultiplier(type, target.defenderTypes) > 1)
    if (hasWeakness && finalMultiplier <= 1) {
      finalMultiplier = 0
      immunitySource = 'Wonder Guard'
      passiveSources.push('Wonder Guard')
    }
  }
  return {
    ...input.resolved,
    passiveMultiplier: finalMultiplier,
    passiveSources,
    finalMultiplier,
    finalRelation: finalMultiplier === 0 ? 'immune'
      : finalMultiplier < 1 ? 'resistant'
        : finalMultiplier > 1 ? 'weak' : 'neutral',
    immunitySource,
  }
}

/** Teamwork/Victory Star outgoing Accuracy providers. */
export const aa085to100AccuracyModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly targetPlacementId?: string
  readonly script?: Pick<MoveAutomationScript, 'range'>
}): readonly { readonly sourceId: string; readonly reason: string; readonly value: number }[] => {
  const result: { sourceId: string; reason: string; value: number }[] = []
  const actorId = input.context.actor.placement.id
  const victory = input.context.queries.placements.all().find(placement => (
    placement.id !== actorId
    && input.context.queries.relationships.resolve(placement.id, actorId).relationship === 'ally'
    && input.context.queries.abilities.has(placement.id, 'Victory Star')
  ))
  if (victory) result.push({
    sourceId: `ability.victory-star:${victory.id}`,
    reason: 'Victory Star Accuracy', value: 2,
  })
  if (activeEffect(input.context, actorId, 'aa093-sunglow-accuracy')) result.push({
    sourceId: 'ability.sunglow', reason: 'Sunglow Accuracy', value: 2,
  })
  if (input.targetPlacementId && /\bmelee\b/i.test(input.script?.range ?? '')) {
    const target = input.context.queries.tokens.get(input.targetPlacementId)
    const teamwork = target && input.context.queries.tokens.all().find(provider => (
      provider.id !== actorId
      && input.context.queries.relationships.resolve(provider.id, actorId).relationship === 'ally'
      && input.context.queries.abilities.has(provider.id, 'Teamwork')
      && ptuGridDistanceBetweenFootprints(provider, target) <= 1
    ))
    if (teamwork) result.push({
      sourceId: `ability.teamwork:${teamwork.id}`,
      reason: 'Teamwork Accuracy', value: 2,
    })
  }
  return Object.freeze(result)
}
