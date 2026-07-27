import type { EncounterEffectDuration } from '#shared/moveAutomation/encounterEffects'
import { MOVE_SPEC_PHASES } from '#shared/moveAutomation/spec'
import { SUBSTITUTE_COAT_CAPABILITY_ID } from '#shared/moveAutomation/substitute'
import { POKEMON_TYPE_IDS, pokemonTypeId, type PokemonTypeId } from '#shared/pokemonTypes'
import type {
  MoveBranchEffectOperation,
  MoveConditionEffectOperation,
  MoveEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import { computeMultiplier } from '~/utils/typeChart'
import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'
import {
  reviewedCondition,
  reviewedDamage,
  reviewedDirectHp,
  reviewedHeal,
  reviewedStage,
  standardAccuracy,
  standardTerminalOperations,
} from '../specs/reviewedSpecBuilder'

export const PERSISTENT_234_241_HANDLER_ID = 'ma234-241.persistent-context' as const

const slugFor = (name: string): string => name.normalize('NFKD').replace(/[’']/g, '')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()

const ordered = (operations: readonly MoveEffectOperation[]): readonly MoveEffectOperation[] => [...operations]
  .sort((left, right) => MOVE_SPEC_PHASES.indexOf(left.phase) - MOVE_SPEC_PHASES.indexOf(right.phase))

const durationPolicy = (
  effectId: string,
  duration: EncounterEffectDuration,
): NonNullable<MoveConditionEffectOperation['payload']['duration']> => ({ effectId, duration })

const condition = (input: {
  readonly slug: string
  readonly id: string
  readonly conditionId: string
  readonly recipients?: Parameters<typeof reviewedCondition>[0]['recipients']
  readonly sourceOperationId?: string
  readonly phase?: Parameters<typeof reviewedCondition>[0]['phase']
  readonly duration?: EncounterEffectDuration
  readonly accuracyMinimum?: number
  readonly action?: 'apply' | 'remove'
}): MoveConditionEffectOperation => reviewedCondition({
  slug: input.slug, id: input.id, conditionId: input.conditionId,
  recipients: input.recipients ?? 'hit-targets', action: input.action,
  sourceOperationId: input.sourceOperationId, phase: input.phase,
  ...(input.duration ? { duration: durationPolicy(`${input.slug}.${input.id}`, input.duration) } : {}),
  ...(input.accuracyMinimum ? {
    accuracyRollTrigger: {
      rollId: `${input.slug}.accuracy-roll`,
      trigger: { kind: 'range', minimum: input.accuracyMinimum },
    },
  } : {}),
  applyTypeImmunity: (input.recipients ?? 'hit-targets') !== 'actor',
})

const clearConditions = (
  slug: string,
  recipients: 'actor' | 'selected-targets',
): MoveConditionEffectOperation => ({
  id: `${slug}.clear-statuses`, kind: 'condition', source: { kind: 'move', id: `move.${slug}` },
  recipients: { kind: recipients }, phase: 'hit', reasonCode: `${slug}.clear-statuses`,
  payload: {
    action: 'clear', conditionId: null, conditionSource: null,
    filter: { groups: ['persistent', 'volatile'], conditionIds: [], excludedConditionIds: [] },
    randomChoice: null, duration: null, saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
})

const numericEffect = (input: {
  readonly slug: string
  readonly id: string
  readonly recipients: MoveTemporaryEffectOperation['recipients']['kind']
  readonly recipientScope?: 'placements' | 'actor-side'
  readonly attribute: 'accuracy' | 'evasion' | 'damage' | 'damage-reduction'
  readonly operation: 'add' | 'multiply' | 'set' | 'resist-step'
  readonly value: number
  readonly duration: EncounterEffectDuration
  readonly charges?: number | null
  readonly damageClass?: 'physical' | 'special' | 'any'
  readonly tags?: readonly string[]
}): MoveTemporaryEffectOperation => ({
  id: `${input.slug}.${input.id}`, kind: 'temporary-effect', source: { kind: 'move', id: `move.${input.slug}` },
  recipients: { kind: input.recipients }, phase: 'schedule', reasonCode: `${input.slug}.${input.id}`,
  payload: {
    action: 'add', effectId: `${input.slug}.${input.id}`, recipientScope: input.recipientScope ?? 'placements',
    definition: {
      kind: 'numeric-modifier', duration: input.duration, stacks: 1, charges: input.charges ?? null,
      stackPolicy: { kind: 'refresh', maxStacks: null },
      chargePolicy: input.charges
        ? { kind: 'consume-on-trigger', amount: 1 }
        : { kind: 'none', amount: null },
      tags: [...(input.tags ?? []), input.slug, input.id],
      payload: {
        attribute: input.attribute, operation: input.operation, value: input.value, rounding: 'none',
        ...(input.damageClass ? { damageClass: input.damageClass } : {}),
      },
      dispel: { policy: 'matching-tags', tags: [input.slug, input.id] }, transferPolicy: 'expire',
    },
  },
})

const markerEffect = (input: {
  readonly slug: string
  readonly id: string
  readonly recipients: MoveTemporaryEffectOperation['recipients']['kind']
  readonly duration: EncounterEffectDuration
  readonly charges?: number | null
  readonly recipientScope?: 'placements' | 'actor-side'
  readonly transferPolicy?: 'retain' | 'expire' | 'baton-pass'
}): MoveTemporaryEffectOperation => ({
  id: `${input.slug}.${input.id}`, kind: 'temporary-effect', source: { kind: 'move', id: `move.${input.slug}` },
  recipients: { kind: input.recipients }, phase: 'schedule', reasonCode: `${input.slug}.${input.id}`,
  payload: {
    action: 'add', effectId: `${input.slug}.${input.id}`, recipientScope: input.recipientScope ?? 'placements',
    definition: {
      kind: 'condition', duration: input.duration, stacks: 1, charges: input.charges ?? null,
      stackPolicy: { kind: 'refresh', maxStacks: null },
      chargePolicy: input.charges ? { kind: 'consume-on-trigger', amount: 1 } : { kind: 'none', amount: null },
      tags: [input.slug, input.id], payload: { conditionId: input.id, action: 'apply', saveTiming: null },
      dispel: { policy: 'matching-tags', tags: [input.slug, input.id] },
      transferPolicy: input.transferPolicy ?? 'expire',
    },
  },
})

const typeOverlay = (
  slug: string,
  id: string,
  recipients: MoveTemporaryEffectOperation['recipients']['kind'],
  values: readonly PokemonTypeId[],
  action: 'replace' | 'add' = 'replace',
  duration: EncounterEffectDuration = { kind: 'scene', remaining: null },
): MoveTemporaryEffectOperation => ({
  id: `${slug}.${id}`, kind: 'temporary-effect', source: { kind: 'move', id: `move.${slug}` },
  recipients: { kind: recipients }, phase: 'schedule', reasonCode: `${slug}.${id}`,
  payload: {
    action: 'add', effectId: `${slug}.type-overlay`, recipientScope: 'placements',
    definition: {
      kind: 'creature-rule-overlay', duration, stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
      tags: [slug, 'type'],
      payload: { domain: 'type', action, values, referencePlacementId: null, suppressionScope: null },
      dispel: { policy: 'matching-tags', tags: [slug, 'type'] }, transferPolicy: 'expire',
    },
  },
})

const abilityOverlay = (
  slug: string,
  id: string,
  abilityName: string,
): MoveTemporaryEffectOperation => ({
  id: `${slug}.suppress-${id}`, kind: 'temporary-effect', source: { kind: 'move', id: `move.${slug}` },
  recipients: { kind: 'hit-targets' }, phase: 'schedule', reasonCode: `${slug}.suppress-ability`,
  payload: {
    action: 'add', effectId: `${slug}.ability-suppression`, recipientScope: 'placements',
    definition: {
      kind: 'creature-rule-overlay', duration: { kind: 'scene', remaining: null }, stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
      tags: [slug, 'ability-suppression'],
      payload: { domain: 'ability', action: 'suppress', values: [abilityName], referencePlacementId: null, suppressionScope: 'listed' },
      dispel: { policy: 'matching-tags', tags: [slug, 'ability-suppression'] }, transferPolicy: 'expire',
    },
  },
})

const vortex = (
  slug: string,
  sourceType: string,
  recipients: 'hit-targets' | 'attacked-targets' = 'hit-targets',
  dcBonus = 0,
): MoveTemporaryEffectOperation => ({
  id: `${slug}.vortex`, kind: 'temporary-effect', source: { kind: 'move', id: `move.${slug}` },
  recipients: { kind: recipients }, phase: 'after-damage', reasonCode: `${slug}.vortex`,
  payload: {
    action: 'add', effectId: 'vortex.target', recipientScope: 'placements',
    definition: {
      kind: 'vortex', duration: { kind: 'scene', remaining: null }, stacks: 1, charges: 4,
      stackPolicy: { kind: 'replace', maxStacks: null }, chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
      tags: ['condition', 'vortex'],
      payload: { sourceType, tickPercent: 10, escapeDcs: [20 + dcBonus, 14 + dcBonus, 8 + dcBonus, 2 + dcBonus] },
      dispel: { policy: 'matching-tags', tags: ['vortex'] }, transferPolicy: 'retain',
    },
  },
})

interface AttackDefinition {
  readonly db: number
  readonly cls: 'physical' | 'special'
  readonly type: string
  readonly area?: boolean
}
const ATTACKS: Readonly<Record<string, AttackDefinition>> = {
  'Core Enforcer': { db: 10, cls: 'special', type: 'dragon', area: true },
  'Fire Spin': { db: 4, cls: 'special', type: 'fire' },
  'Glacial Lance': { db: 13, cls: 'physical', type: 'ice', area: true },
  'Headlong Rush': { db: 10, cls: 'physical', type: 'ground' },
  'High Horsepower': { db: 10, cls: 'physical', type: 'ground' },
  Infestation: { db: 4, cls: 'special', type: 'bug' },
  'Lash Out': { db: 8, cls: 'physical', type: 'dark' },
  Lunge: { db: 8, cls: 'physical', type: 'bug' },
  'Magma Storm': { db: 10, cls: 'special', type: 'fire' },
  'Psyshield Bash': { db: 7, cls: 'physical', type: 'psychic' },
  Psyshock: { db: 8, cls: 'special', type: 'psychic' },
  Psystrike: { db: 10, cls: 'special', type: 'psychic' },
  Rage: { db: 2, cls: 'physical', type: 'normal' },
  'Secret Sword': { db: 8, cls: 'special', type: 'fighting' },
  'Snap Trap': { db: 4, cls: 'physical', type: 'grass' },
  'Spirit Shackle': { db: 8, cls: 'physical', type: 'ghost' },
  'Thousand Waves': { db: 9, cls: 'physical', type: 'ground', area: true },
  'Thunder Cage': { db: 8, cls: 'special', type: 'electric', area: true },
  'Trop Kick': { db: 7, cls: 'physical', type: 'grass' },
  Whirlpool: { db: 4, cls: 'special', type: 'water' },
}

const basicAttack = (
  name: string,
  override: Partial<AttackDefinition> = {},
): MoveEffectOperation[] => {
  const definition = { ...ATTACKS[name], ...override } as AttackDefinition
  const slug = slugFor(name)
  return [
    standardAccuracy(slug),
    reviewedDamage({
      slug, damageBase: definition.db, damageClass: definition.cls, moveType: definition.type,
      ...(definition.area ? { recipients: 'attacked-targets' as const } : {}),
      ...(['Psyshock', 'Psystrike', 'Secret Sword'].includes(name) ? {
        defenseStat: {
          kind: 'stat' as const, subject: { kind: 'current-target' as const }, stat: 'defense' as const,
          combatStagePolicy: 'honor' as const, stageModifierPolicy: 'honor' as const,
        },
      } : {}),
    }),
  ]
}

const target = (context: RegisteredMoveHandlerContext) => {
  const placement = context.selectedPlacements[0]
  if (!placement) throw new Error(`${context.intent.moveName} requires one target.`)
  const token = context.queries.tokens.get(placement.id)
  const state = context.queries.targetStates.resolve(placement.id)
  if (!token || !state) throw new Error(`${context.intent.moveName} target is unavailable.`)
  return { placement, token, state }
}

const typeChoice = (
  slug: string,
  types: readonly PokemonTypeId[],
): readonly MoveEffectOperation[] => {
  const options = [...new Set(types)]
  if (options.length === 0) options.push('normal')
  if (options.length === 1) {
    return [typeOverlay(slug, `become-${options[0]}`, 'actor', [options[0]!])]
  }
  const branch: MoveBranchEffectOperation = {
    id: `${slug}.choose-type`, kind: 'branch', source: { kind: 'move', id: `move.${slug}` },
    recipients: { kind: 'actor' }, phase: 'target', reasonCode: `${slug}.choose-type`,
    payload: {
      kind: 'choice', selectionId: `${slug}.type`, scope: 'resolution', owner: 'actor',
      requestId: `${slug}.type`, promptKey: `move.${slug}.choose-type`,
      options: options.map(type => ({ id: type, labelKey: `type.${type}`, operationIds: [`${slug}.become-${type}`] })),
      pass: null,
    },
  }
  return [branch, ...options.map(type => typeOverlay(slug, `become-${type}`, 'actor', [type]))]
}

const conversion = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  let types: PokemonTypeId[]
  if (context.intent.moveName === 'Conversion2') {
    const lastType = context.queries.history.lastDamagingMoveReceived(context.actor.placement.id)?.moveType
    types = lastType
      ? POKEMON_TYPE_IDS.filter(type => computeMultiplier(lastType, [type]) < 1)
      : ['normal']
  }
  else {
    const sheet = context.resolvedSheets.find(value => value.slug === context.actor.placement.sheetSlug)
    const moves = sheet && 'movelist' in sheet.sheet && Array.isArray(sheet.sheet.movelist)
      ? sheet.sheet.movelist
      : []
    types = moves.flatMap((move) => {
      const name = typeof move === 'string' ? move : move && typeof move === 'object' && 'name' in move ? String(move.name) : ''
      const type = context.queries.rules.legacyScriptFor(name)?.type
      const parsed = type ? pokemonTypeId(type) : null
      return parsed ? [parsed] : []
    })
    if (!types.length) types = ['normal']
  }
  return [...typeChoice(slugFor(context.intent.moveName), types), ...standardTerminalOperations(slugFor(context.intent.moveName))]
}

const suppressAbility = (
  context: RegisteredMoveHandlerContext,
  afterDamage: boolean,
): readonly MoveEffectOperation[] => {
  const slug = slugFor(context.intent.moveName)
  const abilities = [...new Set(target(context).token.abilityNames ?? [])]
  const prefix = afterDamage ? basicAttack(context.intent.moveName) : [standardAccuracy(slug)]
  if (!abilities.length) return [...prefix, ...standardTerminalOperations(slug)]
  const branch: MoveBranchEffectOperation = {
    id: `${slug}.choose-ability`, kind: 'branch', source: { kind: 'move', id: `move.${slug}` },
    recipients: { kind: 'hit-targets' }, phase: 'after-damage', reasonCode: `${slug}.choose-ability`,
    payload: {
      kind: 'choice', selectionId: `${slug}.ability`, scope: 'recipient', owner: 'actor',
      requestId: `${slug}.ability`, promptKey: `move.${slug}.choose-ability`,
      options: abilities.map((ability, index) => ({
        id: `ability-${index + 1}`, labelKey: `ability.${ability.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        operationIds: [`${slug}.suppress-ability-${index + 1}`],
      })), pass: null,
    },
  }
  return [
    ...prefix, branch,
    ...abilities.map((ability, index) => abilityOverlay(slug, `ability-${index + 1}`, ability)),
    ...standardTerminalOperations(slug),
  ]
}

const curse = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const ghost = context.queries.targetStates.resolve(context.actor.placement.id)?.typeIds.includes('ghost') ?? false
  if (!ghost) return [
    reviewedStage({ slug: 'curse', id: 'lower-speed', recipients: 'actor', stage: 'spd', value: -1, phase: 'hit' }),
    reviewedStage({ slug: 'curse', id: 'raise-attack', recipients: 'actor', stage: 'atk', value: 1, phase: 'hit' }),
    reviewedStage({ slug: 'curse', id: 'raise-defense', recipients: 'actor', stage: 'def', value: 1, phase: 'hit' }),
    ...standardTerminalOperations('curse'),
  ]
  return [
    reviewedDirectHp({ slug: 'curse', id: 'hp-cost', recipients: 'actor', calculation: { kind: 'percent-max', percent: 100 / 3 }, phase: 'pay', cost: { kind: 'cost', timing: 'declaration', minimumRemaining: null, damageOperationId: null } }),
    condition({ slug: 'curse', id: 'cursed', conditionId: 'cursed', recipients: 'selected-targets', phase: 'hit', duration: { kind: 'scene', remaining: null } }),
    ...standardTerminalOperations('curse'),
  ]
}

const delayedMarker = (
  name: 'Doom Desire' | 'Future Sight' | 'Wish',
): readonly MoveEffectOperation[] => {
  const slug = slugFor(name)
  return [
    markerEffect({
      slug, id: name === 'Wish' ? 'delayed-heal' : 'delayed-attack', recipients: 'selected-targets',
      duration: {
        kind: 'turns', subject: 'source', boundary: 'end',
        remaining: name === 'Wish' ? 2 : 1,
      },
      ...(name === 'Wish' ? { transferPolicy: 'retain' as const } : {}),
    }),
    ...standardTerminalOperations(slug),
  ]
}

const fullRestorationSacrifice = (
  name: 'Healing Wish' | 'Lunar Dance',
): readonly MoveEffectOperation[] => {
  const slug = slugFor(name)
  return [
    reviewedDirectHp({ slug, id: 'self-faint', recipients: 'actor', mode: 'set', calculation: { kind: 'fixed', value: 0 }, phase: 'hit', hitPointMarkers: 'ignore' }),
    reviewedHeal({ slug, id: 'full-heal', recipients: 'selected-targets', mode: 'full', calculation: null, phase: 'hit' }),
    clearConditions(slug, 'selected-targets'),
    condition({ slug, id: 'fainted', conditionId: 'fainted', recipients: 'actor', phase: 'ko' }),
    ...standardTerminalOperations(slug),
  ]
}

const splitEffect = (
  name: 'Guard Split' | 'Power Split',
): readonly MoveEffectOperation[] => {
  const slug = slugFor(name)
  const guard = name === 'Guard Split'
  return [
    numericEffect({ slug, id: guard ? 'target-defense-loss' : 'target-power-loss', recipients: 'selected-targets', attribute: guard ? 'damage-reduction' : 'damage', operation: 'add', value: -5, duration: { kind: 'scene', remaining: null } }),
    numericEffect({ slug, id: guard ? 'actor-damage-reduction' : 'actor-damage-bonus', recipients: 'actor', attribute: guard ? 'damage-reduction' : 'damage', operation: 'add', value: 5, duration: { kind: 'scene', remaining: null } }),
    ...standardTerminalOperations(slug),
  ]
}

const vortexAttack = (name: string): readonly MoveEffectOperation[] => {
  const slug = slugFor(name)
  const sourceType = ATTACKS[name]?.type ?? ({ 'Magma Storm': 'fire' }[name] ?? 'normal')
  const bonus = ['Snap Trap', 'Thunder Cage'].includes(name) ? 3 : 0
  return [
    ...basicAttack(name),
    vortex(slug, sourceType, name === 'Magma Storm' ? 'attacked-targets' : 'hit-targets', bonus),
    ...standardTerminalOperations(slug),
  ]
}

const stockpileCount = (context: RegisteredMoveHandlerContext): number => {
  const actorId = context.actor.placement.id
  const completed = context.queries.history.completedMovesThisScene(actorId)
  const lastReset = completed.findLastIndex(move => ['Spit Up', 'Swallow'].includes(move.canonicalId))
  return Math.min(3, completed.slice(lastReset + 1).filter(move => move.canonicalId === 'Stockpile').length)
}

const stockpileFamily = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const name = context.intent.moveName
  if (name === 'Stockpile') return [
    reviewedStage({ slug: 'stockpile', id: 'raise-defense', recipients: 'actor', stage: 'def', value: 1, phase: 'hit' }),
    reviewedStage({ slug: 'stockpile', id: 'raise-special-defense', recipients: 'actor', stage: 'sdef', value: 1, phase: 'hit' }),
    markerEffect({ slug: 'stockpile', id: 'count', recipients: 'actor', duration: { kind: 'scene', remaining: null }, charges: 3 }),
    ...standardTerminalOperations('stockpile'),
  ]
  const baseCount = stockpileCount(context)
  const count = context.queries.abilities.has(context.actor.placement.id, 'Big Swallow')
    ? Math.min(3, baseCount + 1)
    : baseCount
  if (name === 'Spit Up') {
    if (count < 1) throw new Error('Spit Up requires an authoritative Stockpiled count.')
    return [...basicAttack(name, { db: count * 8, cls: 'special', type: 'normal' }), ...standardTerminalOperations('spit-up')]
  }
  const percent = count === 1 ? 25 : count === 2 ? 50 : count >= 3 ? 100 : 0
  return [
    reviewedHeal({ slug: 'swallow', id: 'heal', recipients: 'actor', calculation: { kind: 'percent-max', percent }, phase: 'hit' }),
    reviewedStage({ slug: 'swallow', id: 'remove-defense', recipients: 'actor', stage: 'def', value: -count, phase: 'hit' }),
    reviewedStage({ slug: 'swallow', id: 'remove-special-defense', recipients: 'actor', stage: 'sdef', value: -count, phase: 'hit' }),
    ...standardTerminalOperations('swallow'),
  ]
}

const substitute = (): readonly MoveEffectOperation[] => [
  reviewedDirectHp({
    slug: 'substitute', id: 'hp-cost', recipients: 'actor', calculation: { kind: 'percent-max', percent: 25 }, phase: 'pay',
    cost: { kind: 'cost', timing: 'declaration', minimumRemaining: 1, damageOperationId: null },
  }),
  reviewedHeal({
    slug: 'substitute', id: 'temporary-hp', recipients: 'actor', pool: 'temporary-hit-points', phase: 'hit',
    calculation: {
      kind: 'formula', expression: {
        kind: 'arithmetic', operator: 'add', operands: [{
          kind: 'arithmetic', operator: 'multiply', operands: [{
            kind: 'stat', subject: { kind: 'actor' }, stat: 'maximum-hp',
            combatStagePolicy: 'ignore', stageModifierPolicy: 'ignore',
          }, { kind: 'constant', value: 0.25 }],
        }, { kind: 'constant', value: 1 }],
      },
    },
  }),
  {
    id: 'substitute.coat',
    kind: 'temporary-effect',
    source: { kind: 'move', id: 'move.substitute' },
    recipients: { kind: 'actor' },
    phase: 'schedule',
    reasonCode: 'substitute.coat',
    payload: {
      action: 'add',
      effectId: 'substitute.coat',
      recipientScope: 'placements',
      definition: {
        kind: 'capability',
        duration: { kind: 'scene', remaining: null },
        stacks: 1,
        charges: null,
        stackPolicy: { kind: 'refresh', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null },
        tags: ['substitute', 'coat'],
        payload: { capabilityId: SUBSTITUTE_COAT_CAPABILITY_ID, action: 'grant' },
        dispel: { policy: 'matching-tags', tags: ['substitute', 'coat'] },
        transferPolicy: 'expire',
      },
    },
  },
  ...standardTerminalOperations('substitute'),
]

const statusMove = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const name = context.intent.moveName
  const slug = slugFor(name)
  if (name === 'Destiny Bond') return [markerEffect({ slug, id: 'bound', recipients: 'area-targets', duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 } }), ...standardTerminalOperations(slug)]
  if (name === 'Double Team') return [numericEffect({ slug, id: 'activations', recipients: 'actor', attribute: 'evasion', operation: 'add', value: 2, duration: { kind: 'scene', remaining: null }, charges: 3 }), ...standardTerminalOperations(slug)]
  if (name === 'Electrify') return [markerEffect({ slug, id: 'outgoing-electric', recipients: 'selected-targets', duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 } }), ...standardTerminalOperations(slug)]
  if (name === 'Forest’s Curse') return [standardAccuracy(slug), typeOverlay(slug, 'add-grass', 'hit-targets', ['grass'], 'add', { kind: 'turns', subject: 'target', boundary: 'end', remaining: 5 }), ...standardTerminalOperations(slug)]
  if (name === 'Laser Focus') return [markerEffect({ slug, id: 'next-critical', recipients: 'actor', duration: { kind: 'scene', remaining: null }, charges: 1 }), ...standardTerminalOperations(slug)]
  if (name === 'Leech Seed') return [standardAccuracy(slug), markerEffect({ slug, id: 'seeded', recipients: 'hit-targets', duration: { kind: 'scene', remaining: null } }), ...standardTerminalOperations(slug)]
  if (name === 'Mean Look') return [condition({ slug, id: 'trapped', conditionId: 'trapped', recipients: 'selected-targets', phase: 'hit', duration: { kind: 'scene', remaining: null } }), condition({ slug, id: 'slowed', conditionId: 'slowed', recipients: 'selected-targets', phase: 'hit', duration: { kind: 'scene', remaining: null } }), ...standardTerminalOperations(slug)]
  if (name === 'Mind Reader') return [markerEffect({ slug, id: 'read', recipients: 'selected-targets', duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 }, charges: 1 }), ...standardTerminalOperations(slug)]
  if (name === 'Nightmare') return [standardAccuracy(slug), condition({ slug, id: 'bad-sleep', conditionId: 'bad-sleep', sourceOperationId: `${slug}.accuracy`, phase: 'hit', duration: { kind: 'scene', remaining: null } }), ...standardTerminalOperations(slug)]
  if (name === 'Octolock') return [condition({ slug, id: 'trapped', conditionId: 'trapped', recipients: 'selected-targets', phase: 'hit', duration: { kind: 'scene', remaining: null } }), reviewedStage({ slug, id: 'lower-defense', recipients: 'selected-targets', stage: 'def', value: -1, phase: 'hit' }), reviewedStage({ slug, id: 'lower-special-defense', recipients: 'selected-targets', stage: 'sdef', value: -1, phase: 'hit' }), ...standardTerminalOperations(slug)]
  if (name === 'Perish Song') return [condition({ slug, id: 'perish-count', conditionId: 'perish-count-3', recipients: 'area-targets', phase: 'hit', duration: { kind: 'turns', subject: 'target', boundary: 'start', remaining: 3 } }), ...standardTerminalOperations(slug)]
  if (name === 'Spider Web') return [condition({ slug, id: 'stuck', conditionId: 'stuck', recipients: 'selected-targets', phase: 'hit', duration: { kind: 'scene', remaining: null } }), condition({ slug, id: 'trapped', conditionId: 'trapped', recipients: 'selected-targets', phase: 'hit', duration: { kind: 'scene', remaining: null } }), ...standardTerminalOperations(slug)]
  if (name === 'Spotlight') return [condition({ slug, id: 'blinded', conditionId: 'blinded', recipients: 'selected-targets', phase: 'hit', duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 } }), condition({ slug, id: 'vulnerable', conditionId: 'vulnerable', recipients: 'selected-targets', phase: 'hit', duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 } }), ...standardTerminalOperations(slug)]
  throw new Error(`Unsupported persistent status move ${name}.`)
}

const blessing = (name: string): readonly MoveEffectOperation[] => {
  const slug = slugFor(name)
  if (name === 'Light Screen') return [numericEffect({ slug, id: 'blessing', recipients: 'actor', recipientScope: 'actor-side', attribute: 'damage-reduction', operation: 'resist-step', value: 1, damageClass: 'special', duration: { kind: 'scene', remaining: null }, charges: 2 }), ...standardTerminalOperations(slug)]
  const charges = name === 'Lucky Chant' || name === 'Mist' || name === 'Safeguard' ? 3 : 1
  return [markerEffect({ slug, id: 'blessing', recipients: 'actor', recipientScope: 'actor-side', duration: { kind: 'scene', remaining: null }, charges }), ...standardTerminalOperations(slug)]
}

const rest = (): readonly MoveEffectOperation[] => [
  reviewedHeal({ slug: 'rest', id: 'full-heal', recipients: 'actor', mode: 'full', calculation: null, phase: 'hit' }),
  clearConditions('rest', 'actor'),
  condition({ slug: 'rest', id: 'sleep', conditionId: 'sleep', recipients: 'actor', phase: 'hit', duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 2 } }),
  ...standardTerminalOperations('rest'),
]

const run = (context: RegisteredMoveHandlerContext) => {
  const name = context.intent.moveName
  const slug = slugFor(name)
  let operations: readonly MoveEffectOperation[]
  if (name === 'Conversion' || name === 'Conversion2') operations = conversion(context)
  else if (name === 'Core Enforcer') operations = suppressAbility(context, true)
  else if (name === 'Gastro Acid') operations = suppressAbility(context, false)
  else if (name === 'Curse') operations = curse(context)
  else if (name === 'Doom Desire' || name === 'Future Sight' || name === 'Wish') operations = delayedMarker(name)
  else if (name === 'Healing Wish' || name === 'Lunar Dance') operations = fullRestorationSacrifice(name)
  else if (name === 'Guard Split' || name === 'Power Split') operations = splitEffect(name)
  else if (['Fire Spin', 'Infestation', 'Magma Storm', 'Snap Trap', 'Thunder Cage', 'Whirlpool'].includes(name)) operations = vortexAttack(name)
  else if (name === 'Spit Up' || name === 'Stockpile' || name === 'Swallow') operations = stockpileFamily(context)
  else if (name === 'Substitute') operations = substitute()
  else if (['Destiny Bond','Double Team','Electrify','Forest’s Curse','Laser Focus','Leech Seed','Mean Look','Mind Reader','Nightmare','Octolock','Perish Song','Spider Web','Spotlight'].includes(name)) operations = statusMove(context)
  else if (['Light Screen', 'Lucky Chant', 'Mist', 'Safeguard'].includes(name)) operations = blessing(name)
  else if (name === 'Rest') operations = rest()
  else if (name === 'Lunar Blessing') operations = [reviewedHeal({ slug, id: 'heal', recipients: 'actor', calculation: { kind: 'percent-max', percent: 50 }, phase: 'hit' }), clearConditions(slug, 'actor'), numericEffect({ slug, id: 'evasion', recipients: 'actor', attribute: 'evasion', operation: 'add', value: 2, duration: { kind: 'scene', remaining: null } }), ...standardTerminalOperations(slug)]
  else if (name === 'Roost') {
    const types = context.queries.targetStates.resolve(context.actor.placement.id)?.typeIds ?? []
    const remaining = types.filter(type => type !== 'flying').map(type => pokemonTypeId(type)).filter((type): type is PokemonTypeId => type !== null)
    operations = [reviewedHeal({ slug, id: 'heal', recipients: 'actor', calculation: { kind: 'percent-max', percent: 50 }, phase: 'hit' }), ...(types.includes('flying') ? [typeOverlay(slug, 'lose-flying', 'actor', remaining.length ? remaining : ['normal'], 'replace', { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 })] : []), ...standardTerminalOperations(slug)]
  }
  else if (name === 'Sonic Boom') operations = [standardAccuracy(slug), reviewedDirectHp({ slug, id: 'fixed-loss', recipients: 'hit-targets', calculation: { kind: 'fixed', value: 15 }, phase: 'damage', accuracyRollId: `${slug}.accuracy-roll`, applyTypeImmunity: true }), ...standardTerminalOperations(slug)]
  else if (name === 'Sing') operations = [standardAccuracy(slug), condition({ slug, id: 'sleep', conditionId: 'sleep', recipients: 'hit-targets', sourceOperationId: `${slug}.accuracy`, phase: 'hit' }), condition({ slug, id: 'miss-slow', conditionId: 'slowed', recipients: 'missed-targets', sourceOperationId: `${slug}.accuracy`, phase: 'miss', duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 } }), numericEffect({ slug, id: 'miss-evasion', recipients: 'missed-targets', attribute: 'evasion', operation: 'add', value: -2, duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 } }), ...standardTerminalOperations(slug)]
  else if (name === 'Sweet Kiss') operations = [standardAccuracy(slug), condition({ slug, id: 'confused', conditionId: 'confused', recipients: 'hit-targets', sourceOperationId: `${slug}.accuracy`, phase: 'hit' }), numericEffect({ slug, id: 'miss-accuracy', recipients: 'missed-targets', attribute: 'accuracy', operation: 'add', value: -2, duration: { kind: 'rounds', boundary: 'end', remaining: 1 } }), ...standardTerminalOperations(slug)]
  else if (name === 'Tar Shot') operations = [standardAccuracy(slug), condition({ slug, id: 'tarred', conditionId: 'tarred', recipients: 'hit-targets', sourceOperationId: `${slug}.accuracy`, phase: 'hit', duration: { kind: 'scene', remaining: null } }), reviewedStage({ slug, id: 'lower-speed', recipients: 'hit-targets', stage: 'spd', value: -1, sourceOperationId: `${slug}.accuracy`, phase: 'hit', applyTypeImmunity: true }), ...standardTerminalOperations(slug)]
  else if (name === 'Victory Dance') operations = [reviewedStage({ slug, id: 'raise-defense', recipients: 'actor', stage: 'def', value: 1, phase: 'hit' }), numericEffect({ slug, id: 'next-fighting-damage', recipients: 'actor', attribute: 'damage', operation: 'multiply', value: 2, duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 }, charges: 1 }), ...standardTerminalOperations(slug)]
  else if (name === 'Water Sport') operations = [numericEffect({ slug, id: 'fire-resistance', recipients: 'area-targets', attribute: 'damage-reduction', operation: 'resist-step', value: 1, damageClass: 'any', duration: { kind: 'scene', remaining: null }, charges: 1 }), ...standardTerminalOperations(slug)]
  else {
    operations = [...basicAttack(name)]
    if (name === 'Glacial Lance') operations = [...operations, condition({ slug, id: 'stuck', conditionId: 'stuck', sourceOperationId: `${slug}.damage`, duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 } }), condition({ slug, id: 'trapped', conditionId: 'trapped', sourceOperationId: `${slug}.damage`, duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 } })]
    if (name === 'Headlong Rush') operations = [...operations, reviewedStage({ slug, id: 'lower-defense', recipients: 'actor', stage: 'def', value: -1, sourceOperationId: `${slug}.damage` }), reviewedStage({ slug, id: 'lower-special-defense', recipients: 'actor', stage: 'sdef', value: -1, sourceOperationId: `${slug}.damage` })]
    if (name === 'Lunge' || name === 'Trop Kick') operations = [...operations, numericEffect({ slug, id: 'target-damage-penalty', recipients: 'hit-targets', attribute: 'damage', operation: 'add', value: -5, duration: { kind: 'rounds', boundary: 'end', remaining: 1 } })]
    if (name === 'Psyshield Bash') operations = [...operations, numericEffect({ slug, id: 'damage-reduction', recipients: 'actor', attribute: 'damage-reduction', operation: 'add', value: 5, duration: { kind: 'rounds', boundary: 'end', remaining: 1 } })]
    if (name === 'Rage') operations = [...operations, markerEffect({ slug, id: 'enraged', recipients: 'actor', duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 } })]
    if (name === 'Spirit Shackle' || name === 'Thousand Waves') operations = [...operations, condition({ slug, id: 'trapped', conditionId: 'trapped', sourceOperationId: `${slug}.damage`, duration: { kind: 'rounds', boundary: 'end', remaining: 2 } })]
    operations = [...operations, ...standardTerminalOperations(slug)]
  }
  return {
    operations: ordered(operations),
    traceEntries: [{
      kind: 'predicate' as const, phase: 'declare' as const,
      predicateId: `persistent.${slug}`, outcome: true,
      reasonCode: 'persistent.authoritative-context-resolved', input: { operationCount: operations.length },
    }],
  }
}

export const PERSISTENT_234_241_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration =
  Object.freeze({ id: PERSISTENT_234_241_HANDLER_ID, version: 1, run })
