import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  CANONICAL_POKE_EDGE_IDS,
  CANONICAL_TRAINER_EDGE_IDS,
  parseEdgeLabel,
} from '#shared/edgeAutomation/catalog'
import {
  parseEdgeInstanceData,
  resolveEdgeInstance,
  type EdgeChoiceSelection,
  type EdgeInstanceData,
} from '#shared/edgeAutomation/instances'
import { EDGE_AUTOMATION_MANIFEST } from '#shared/edgeAutomation/manifest'
import { resolveEffectiveEdges } from '../../server/domain/edgeAutomation/effectiveEdges'
import { EDGE_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/edgeAutomation/registry'
import { resolveEdgeProvider } from '../../server/domain/edgeAutomation/passiveProviders'
import { resolveSheetEdgeAbilityGrants, resolveSheetEdgeMoveGrants } from '../../server/domain/edgeAutomation/permanentGrants'
import {
  buildPokeEdgePrerequisiteContext,
  buildTrainerEdgePrerequisiteContext,
} from '../../server/domain/edgeAutomation/prerequisiteContext'
import { evaluateEdgePrerequisite } from '#shared/edgeAutomation/prerequisites'
import { applyEdgeAcquisition } from '../../server/domain/edgeAutomation/acquisition'
import { planPokemonEvolutionEdgeLifecycle } from '../../server/domain/edgeAutomation/pokemonLifecycle'
import { planTrainerEdgeCampaignOperation } from '../../server/domain/edgeAutomation/campaignOperations'
import {
  resolveTrainerEdgeCheck,
  trainerEdgeApRaiseBonusPerPoint,
  trainerEffectiveSkillRankForEffects,
} from '../../server/domain/edgeAutomation/trainerChecks'
import {
  resolveTrainerEdgeManeuverProjection,
  trainerBadMoodCriticalRangeBonus,
  trainerStaminaTemporaryHp,
} from '../../server/domain/edgeAutomation/trainerCombat'
import { planTrainerEdgeTriggeredEffects } from '../../server/domain/edgeAutomation/triggeredEffects'
import {
  pokemonAddedStatPointBudget,
  realizedPotentialBonusStatPoints,
  resolveCapabilities,
  resolveSkills,
  resolveStats,
} from '~/utils/sheets/pokemonDerived'
import { resolveTrainerCapabilities, resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { pokemonMoveEntriesForSheet } from '~/utils/mapTokenMoves'

const choices = (values: Readonly<Record<string, readonly string[]>> = {}): readonly EdgeChoiceSelection[] => (
  Object.entries(values).map(([choiceId, selected]) => ({ choiceId, values: selected }))
)

const edgeInstance = (
  family: 'trainer' | 'poke',
  canonicalId: string,
  selected: Readonly<Record<string, readonly string[]>> = {},
  instanceId = `${family}.edge.${canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
): EdgeInstanceData => ({
  schemaVersion: 1,
  instanceId,
  family,
  canonicalId,
  definitionVersion: 1,
  rank: 1,
  choices: choices(selected),
  acquisition: { kind: 'sheet', sourceId: `sheet.${family}` },
  prerequisiteOverride: null,
})

const trainer = (instances: readonly EdgeInstanceData[] = []): TrainerSheet => ({
  slug: 'trainer-edge-test',
  name: 'Edge Tester',
  level: 20,
  edges: instances.map(instance => ({ name: instance.canonicalId, automation: instance as EdgeInstanceData & { family: 'trainer' } })),
}) as TrainerSheet

const pokemon = (instances: readonly EdgeInstanceData[] = []): CharacterSheet => ({
  slug: 'pokemon-edge-test',
  species: 'Abra',
  level: 30,
  nature: 'Hardy',
  stats: {
    hp: { added: 0 }, atk: { added: 5 }, def: { added: 0 },
    satk: { added: 5 }, sdef: { added: 0 }, spd: { added: 0 },
  },
  abilities: [{ name: 'Synchronize' }],
  movelist: [{ name: 'Fire Blast' }],
  tutorPoints: { earned: 7, spent: instances.length },
  edges: instances.map(instance => ({ name: instance.canonicalId, cost: 1, automation: instance as EdgeInstanceData & { family: 'poke' } })),
}) as CharacterSheet

describe('Edge catalog, identity, and strict instances', () => {
  it('freezes separate complete Trainer and Poké families', () => {
    expect(CANONICAL_TRAINER_EDGE_IDS).toHaveLength(61)
    expect(CANONICAL_POKE_EDGE_IDS).toHaveLength(20)
    expect(EDGE_AUTOMATION_MANIFEST.entries).toHaveLength(81)
    expect(EDGE_AUTOMATION_RUNTIME_REGISTRY.definitions).toHaveLength(81)
    expect(EDGE_AUTOMATION_MANIFEST.entries.filter(row => row.status === 'complete')).toHaveLength(80)
    expect(EDGE_AUTOMATION_MANIFEST.entries.filter(row => row.status === 'delegated-complete').map(row => row.canonicalId)).toEqual(['Breeder'])
  })

  it('never crosses family identity and leaves unknown rows diagnostic-only', () => {
    expect(parseEdgeLabel('trainer', 'Mixed Power').canonicalId).toBeNull()
    expect(parseEdgeLabel('poke', 'Mixed Power').canonicalId).toBe('Mixed Power')
    const unknown = resolveEffectiveEdges({
      ownerId: 'unknown',
      family: 'poke',
      sheet: { ...pokemon(), edges: [{ name: 'Internet Super Edge', effect: 'Win.' }] },
    })
    expect(unknown.instances).toEqual([])
    expect(unknown.unresolved[0]?.reason).toBe('unresolved-identity')
  })

  it('rejects malformed parameters and migrates bounded legacy choices', () => {
    expect(() => parseEdgeInstanceData({ ...edgeInstance('poke', 'Accuracy Training', { 'choice-1': ['Fire Blast'] }), instanceId: '../bad' })).toThrow(/stable ID/)
    const legacy = resolveEdgeInstance({
      family: 'trainer',
      ownerId: 'trainer',
      index: 0,
      entry: { name: 'Basic Skills (Athletics)', basicSkill: 'athletics' },
    })
    expect(legacy.status).toBe('ready')
    expect(legacy.data?.canonicalId).toBe('Basic Skills')
    expect(legacy.data?.choices).toEqual([{ choiceId: 'skill', values: ['athletics'] }])
  })
})

describe('effective projection and permanent grants', () => {
  it('provides ordered, source-labelled passive contributions', () => {
    const sheet = trainer([edgeInstance('trainer', 'Power Boost')])
    const projected = resolveEdgeProvider({ sheet, family: 'trainer', propertyId: 'capability.power', baseValue: 4 })
    expect(projected.value).toBe(6)
    expect(projected.contributions).toMatchObject([{ canonicalId: 'Power Boost', value: 2, applied: true, order: 0 }])
  })

  it('projects Move and Ability grants once with source hashes', () => {
    const trainerSheet = trainer([edgeInstance('trainer', 'Athletic Initiative')])
    expect(resolveSheetEdgeMoveGrants(trainerSheet).map(row => row.canonicalId)).toEqual(['Agility'])
    const pokeSheet = pokemon([
      edgeInstance('poke', 'Mixed Power'),
      edgeInstance('poke', 'Ability Mastery', { 'choice-1': ['Inner Focus'] }),
      edgeInstance('poke', 'Underdog’s Lessons', { 'choice-1': ['Alakazam'], 'choice-2': ['Kinesis'] }),
    ])
    expect(resolveSheetEdgeAbilityGrants(pokeSheet).map(row => row.canonicalId).sort()).toEqual(['Inner Focus', 'Twisted Power'])
    expect(resolveSheetEdgeMoveGrants(pokeSheet).map(row => row.canonicalId)).toEqual(['Kinesis'])
    expect(resolveSheetEdgeMoveGrants(pokeSheet).every(row => /^[0-9a-f]{64}$/.test(row.definitionHash))).toBe(true)
  })
})

describe('authoritative prerequisites and acquisition', () => {
  it('evaluates sheet-derived prerequisite evidence', () => {
    const trainerContext = buildTrainerEdgePrerequisiteContext(trainer())
    expect(evaluateEdgePrerequisite('trainer', 'Power Boost', trainerContext).eligible).toBe(false)
    const pokeContext = buildPokeEdgePrerequisiteContext(pokemon())
    expect(evaluateEdgePrerequisite('poke', 'Mixed Power', pokeContext).eligible).toBe(true)
    expect(evaluateEdgePrerequisite('poke', 'Aura Pulse', pokeContext).eligible).toBe(false)
  })

  it('adds and removes typed Poké Edges with Tutor Point settlement', () => {
    const candidate = edgeInstance('poke', 'Accuracy Training', { 'choice-1': ['Fire Blast'] })
    const added = applyEdgeAcquisition(pokemon(), {
      operation: 'add', family: 'poke', actorRole: 'owner', instance: candidate,
    })
    expect(added.ok).toBe(true)
    expect((added.sheet as CharacterSheet).tutorPoints?.spent).toBe(1)
    expect((added.sheet as CharacterSheet).edges?.[0]?.automation?.canonicalId).toBe('Accuracy Training')
    const removed = applyEdgeAcquisition(added.sheet, {
      operation: 'remove', family: 'poke', actorRole: 'owner', targetInstanceId: candidate.instanceId,
    })
    expect(removed.ok).toBe(true)
    expect((removed.sheet as CharacterSheet).tutorPoints?.spent).toBe(0)
  })

  it('fails closed for invalid choices, repeat limits, and player-authored overrides', () => {
    const badMove = edgeInstance('poke', 'Accuracy Training', { 'choice-1': ['Tackle'] })
    expect(applyEdgeAcquisition(pokemon(), { operation: 'add', family: 'poke', actorRole: 'owner', instance: badMove }).diagnostics[0]?.code)
      .toBe('edge.choice.move-ac-invalid')
    const override = {
      ...edgeInstance('trainer', 'Power Boost'),
      prerequisiteOverride: {
        overrideId: 'override.1', reason: 'Approved build exception', authorizedBy: 'gm.1', createdAt: 1,
        prerequisiteHash: '0'.repeat(64),
      },
    }
    expect(applyEdgeAcquisition(trainer(), { operation: 'add', family: 'trainer', actorRole: 'owner', instance: override }).ok).toBe(false)
  })
})

describe('Trainer Edge owning queries', () => {
  it('applies skill ranks and flat category/Scholar/Enhancement bonuses', () => {
    const sheet = trainer([
      edgeInstance('trainer', 'Scholar'),
      edgeInstance('trainer', 'Categoric Inclination', { category: ['Body'] }),
      edgeInstance('trainer', 'Skill Enhancement', { skills: ['athletics', 'focus'] }),
      edgeInstance('trainer', 'Basic Skills', { skill: ['athletics'] }),
    ])
    const skills = new Map(resolveTrainerSkills(sheet).map(row => [row.key, row]))
    expect(skills.get('athletics')).toMatchObject({ rank: 'Novice', edgeModifier: 3 })
    expect(skills.get('focus')).toMatchObject({ edgeModifier: 2 })
    expect(skills.get('generalEd')).toMatchObject({ edgeModifier: 1 })
  })

  it('applies capability, substitution, stunt, Virtuoso, and AP providers', () => {
    const sheet = trainer([
      edgeInstance('trainer', 'Acrobat'),
      edgeInstance('trainer', 'Power Boost'),
      edgeInstance('trainer', 'Beast Master'),
      edgeInstance('trainer', 'Instinctive Aptitude'),
      edgeInstance('trainer', 'Virtuoso', { skill: ['command'] }),
      edgeInstance('trainer', 'Skill Stunt', { skill: ['intimidate'], circumstance: ['Calm a charging Pokémon'] }, 'trainer.edge.stunt'),
    ])
    const capabilities = new Map(resolveTrainerCapabilities(sheet).rows.map(row => [row.label, row.value]))
    expect(capabilities.get('Power')).toBe(6)
    expect(capabilities.get('High Jump')).toBe(1)
    const check = resolveTrainerEdgeCheck({
      sheet,
      requestedSkill: 'command',
      context: 'low-loyalty-command',
      useSkillStuntInstanceId: 'trainer.edge.stunt',
      circumstance: 'Calm a charging Pokémon',
    })
    expect(check).toMatchObject({ effectiveSkill: 'intimidate', diceDelta: -1, flatRollBonus: 6 })
    expect(trainerEffectiveSkillRankForEffects(sheet, 'command')).toBe(8)
    expect(trainerEdgeApRaiseBonusPerPoint(sheet)).toBe(2)
    expect(trainerEdgeApRaiseBonusPerPoint(sheet, true)).toBe(1)
  })

  it('projects combat triggers and maneuver changes', () => {
    const sheet = trainer([
      edgeInstance('trainer', 'Bad Mood'),
      edgeInstance('trainer', 'Stamina'),
      edgeInstance('trainer', 'Kip Up'),
      edgeInstance('trainer', 'Nimble Movement'),
      edgeInstance('trainer', 'Expert Trickster'),
    ])
    expect(trainerBadMoodCriticalRangeBonus(sheet, ['Burned', 'Confused'])).toBe(2)
    expect(trainerStaminaTemporaryHp(sheet)).toBe(2)
    expect(resolveTrainerEdgeManeuverProjection(sheet, 'dirty-trick')).toMatchObject({ checkBonus: 2, usageConsumedOn: 'success' })
    expect(resolveTrainerEdgeManeuverProjection(sheet, 'disengage').disengageDistance).toBe(2)
    expect(resolveTrainerEdgeManeuverProjection(sheet, 'stand').standFromTrippedAction).toBe('swift')
  })

  it('reduces authoritative trigger events into source-bound effects', () => {
    const sheet = trainer([
      edgeInstance('trainer', 'Stamina'),
      edgeInstance('trainer', 'Demoralize'),
      edgeInstance('trainer', 'Flustering Charisma'),
      edgeInstance('trainer', 'Iron Mind'),
    ])
    expect(planTrainerEdgeTriggeredEffects(sheet, { kind: 'received-critical-hit' }).effects)
      .toContainEqual({ kind: 'temporary-hp', amount: 2 })
    expect(planTrainerEdgeTriggeredEffects(sheet, {
      kind: 'dealt-critical-hit', targetPlacementId: 'target.1', statusMoveNaturalRoll: 19,
    }).effects).toContainEqual({ kind: 'apply-condition', targetPlacementId: 'target.1', conditionId: 'Vulnerable' })
    expect(planTrainerEdgeTriggeredEffects(sheet, {
      kind: 'social-move-hit', targetPlacementIds: ['target.1'],
    }).effects).toContainEqual({ kind: 'save-modifier', targetPlacementId: 'target.1', conditionGroup: 'volatile-status', value: -2, rounds: 1 })
    expect(planTrainerEdgeTriggeredEffects(sheet, {
      kind: 'telepathy-attempt', sourcePlacementId: 'source.1', successful: true,
    }).effects[0]).toMatchObject({ kind: 'private-information', revealSuccess: false })
  })
})

describe('Poké Edge owning queries and lifecycle', () => {
  it('applies stats, stat budget, capabilities, skills, Moves, and AC presentation', () => {
    const sheet = pokemon([
      edgeInstance('poke', 'Underdog’s Strength'),
      edgeInstance('poke', 'Realized Potential'),
      edgeInstance('poke', 'Advanced Mobility', { 'choice-1': ['Overland'] }),
      edgeInstance('poke', 'Capability Training', { 'choice-1': ['Power'] }),
      edgeInstance('poke', 'Skill Improvement', { 'choice-1': ['athletics'] }),
      edgeInstance('poke', 'Accuracy Training', { 'choice-1': ['Fire Blast'] }),
      edgeInstance('poke', 'Underdog’s Lessons', { 'choice-1': ['Alakazam'], 'choice-2': ['Kinesis'] }),
    ])
    expect(resolveStats(sheet).every(stat => stat.edgeAdjustment === 1)).toBe(true)
    expect(realizedPotentialBonusStatPoints(sheet)).toBe(12)
    expect(pokemonAddedStatPointBudget(sheet)).toBeGreaterThan(30)
    const capabilities = new Map(resolveCapabilities(sheet).rows.map(row => [row.label, row.value]))
    expect(capabilities.get('Overland')).toBe(5)
    expect(capabilities.get('Power')).toBe(2)
    expect(resolveSkills(sheet).find(skill => skill.key === 'athletics')?.value).toBe('2d6')
    const moves = pokemonMoveEntriesForSheet(sheet)
    expect(moves.some(row => row.move.name === 'Kinesis' && row.automatic)).toBe(true)
    expect(moves.find(row => row.move.name === 'Fire Blast')?.presentationAccuracyCheckModifier).toBe(-1)
  })

  it('blocks evolution for Underdog’s Strength and refunds Realized Potential', () => {
    const blocked = planPokemonEvolutionEdgeLifecycle(pokemon([
      edgeInstance('poke', 'Underdog’s Strength'),
    ]), 'Kadabra')
    expect(blocked).toMatchObject({ ok: false, reasonCode: 'edge.underdog-strength.prevents-evolution' })

    const refundable = pokemon([edgeInstance('poke', 'Realized Potential')])
    const evolved = planPokemonEvolutionEdgeLifecycle(refundable, 'Alakazam')
    expect(evolved.ok).toBe(true)
    expect(evolved.refundedTutorPoints).toBe(2)
    expect(evolved.sheet.edges).toEqual([])
  })
})

describe('campaign operation handoff and atomic deltas', () => {
  it('plans bounded crafting resources without mutating the sheet', () => {
    const sheet = trainer([edgeInstance('trainer', 'Basic Balls')])
    const plan = planTrainerEdgeCampaignOperation(sheet, {
      actionId: 'craft-basic-ball', outputId: 'Great Ball',
    }, {
      money: 200,
      items: {},
      tools: new Set(['pokeball-toolbox']),
      dailyUses: {},
    })
    expect(plan).toMatchObject({ ok: true, moneyDelta: -175, itemDeltas: { 'Great Ball': 1 } })
    expect(sheet).not.toHaveProperty('money', 25)
  })

  it('keeps Breeder as an honest closed downstream handoff', () => {
    const sheet = trainer([edgeInstance('trainer', 'Breeder')])
    const resources = { money: 0, items: {}, tools: new Set() as Set<never>, dailyUses: {} }
    expect(planTrainerEdgeCampaignOperation(sheet, { actionId: 'begin-breeding' }, resources).reasonCode)
      .toBe('downstream-capability-unavailable')
    expect(planTrainerEdgeCampaignOperation(sheet, { actionId: 'begin-breeding' }, resources, { breedingCapabilityAvailable: true }).delegatedRequest)
      .toEqual({ capabilityId: 'breeding.v1', contractId: 'edge.breeder.request.v1' })
  })
})
