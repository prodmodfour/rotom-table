import { describe, expect, it } from 'vitest'
import type { StoredSheetDocument } from '../../server/storage/sheetRepository'
import {
  CAMPAIGN_TRAINER_CHOICE_ATTENTION_LIMIT,
  detectTrainerChoiceAttention,
  detectTrainerChoiceState,
  projectCampaignTrainerChoiceAttention,
  trainerMilestoneStatPointBudgetBonus,
} from '../../server/domain/campaignAttention/trainerChoiceDetector'
import { detectSheetAdvancementAttention } from '../../server/domain/campaignAttention/advancementDetector'
import type {
  TrainerEdgeEntry,
  TrainerFeatureEntry,
  TrainerSheet,
  TrainerStatKey,
} from '../../src/types/trainerSheet'

const featureNames = [
  'Accentuated Taste', 'Accessorize', 'Action Hero Stunt', 'Adaptable Performance',
  'Adaptive Geography', 'Adrenaline Rush', 'Aerialist', 'Affliction Techniques',
  'Ancient Heritage', 'Apothecary', 'Aqua Vortex', 'Arcane Favor',
] as const
const edgeNames = [
  'Acrobat', 'Apricorn Balls', 'Art of Stealth', 'Athletic Initiative',
  'Bad Mood', 'Basic Balls', 'Basic Cooking', 'Basic Martial Arts',
  'Basic Psionics', 'Beast Master', 'Breeder', 'Charmer',
] as const
const statKeys: readonly TrainerStatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']
const features = (count: number): TrainerFeatureEntry[] => featureNames.slice(0, count).map(name => ({ name }))
const ordinaryEdges = (count: number): TrainerEdgeEntry[] => edgeNames.slice(0, count).map(name => ({ name }))
const skillEdge = (skill: 'athletics' | 'combat' = 'athletics'): TrainerEdgeEntry => ({
  name: 'Basic Skills', basicSkill: skill,
})
const statsWithSpent = (spent: number): TrainerSheet['stats'] => {
  const values = Object.fromEntries(statKeys.map(key => [key, { levelUp: 0 }])) as NonNullable<TrainerSheet['stats']>
  values.hp = { levelUp: spent }
  return values
}
const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 1,
  trainingFeature: 'Focused Training',
  features: features(4),
  edges: ordinaryEdges(4),
  stats: statsWithSpent(10),
  ...overrides,
})
const stored = (document: TrainerSheet = trainer(), revision = 7): StoredSheetDocument => ({
  kind: 'trainer', slug: document.slug, revision, updatedAt: 10_000, document,
})

const levelFiveEdges = (): TrainerEdgeEntry[] => [skillEdge(), ...ordinaryEdges(6)]

describe('campaign Trainer choice attention detector', () => {
  it('accepts a complete Level-1 build and detects missing free Training, Feature/Class, and Edge choices', () => {
    expect(detectTrainerChoiceState(trainer())).toEqual({
      schemaVersion: 1,
      status: 'none',
      pendingKinds: [],
      paidFeatureEntitlement: 4,
      countedFeatureRanks: 4,
      edgeEntitlement: 4,
      countedEdgeRanks: 4,
      reachedMilestones: 0,
      resolvedMilestones: 0,
      expectedBonusSkillEdges: 0,
      recordedBonusSkillEdges: 0,
      milestoneStatPointBudgetBonus: 0,
    })

    const incomplete = detectTrainerChoiceState(trainer({
      trainingFeature: undefined, features: [], edges: [], stats: statsWithSpent(0),
    }))
    expect(incomplete).toMatchObject({
      status: 'pending',
      pendingKinds: ['free-training-feature', 'feature-or-class', 'edge'],
      paidFeatureEntitlement: 4,
      countedFeatureRanks: 0,
      edgeEntitlement: 4,
      countedEdgeRanks: 0,
    })
  })

  it('counts the exact Level-2 bonus Skill Edge and keeps it pending until explicitly recorded', () => {
    const complete = trainer({
      level: 2,
      edges: [skillEdge(), ...ordinaryEdges(5)],
      bonusSkillEdges: 1,
      stats: statsWithSpent(11),
    })
    expect(detectTrainerChoiceState(complete)).toMatchObject({
      status: 'none',
      edgeEntitlement: 6,
      countedEdgeRanks: 6,
      expectedBonusSkillEdges: 1,
      recordedBonusSkillEdges: 1,
    })
    expect(detectTrainerChoiceState({ ...complete, bonusSkillEdges: 0 })).toMatchObject({
      status: 'pending', pendingKinds: ['skill-rank'],
    })
  })

  it('resolves a Level-5 Attack/Special Attack milestone only from exact structured allocation evidence', () => {
    const exact = trainer({
      level: 5,
      features: features(6),
      edges: levelFiveEdges(),
      bonusSkillEdges: 1,
      advancement: [{ level: 5, stats: 2, attack: 2, spAttack: 0, notes: 'ignored prose' }],
      stats: statsWithSpent(16),
    })
    expect(trainerMilestoneStatPointBudgetBonus(exact)).toBe(2)
    expect(detectTrainerChoiceState(exact)).toMatchObject({
      status: 'none', reachedMilestones: 1, resolvedMilestones: 1,
      milestoneStatPointBudgetBonus: 2,
    })
    expect(detectSheetAdvancementAttention({ stored: stored(exact), campaignMinute: 800 })).toBeNull()

    const unspent = { ...exact, stats: statsWithSpent(15) }
    expect(detectSheetAdvancementAttention({ stored: stored(unspent), campaignMinute: 800 }))
      .toMatchObject({ reason: 'unspent-advancement' })

    const malformed = { ...exact, advancement: [{ level: 5, stats: 2, attack: 1, spAttack: 0 }] }
    expect(() => trainerMilestoneStatPointBudgetBonus(malformed)).toThrow('malformed or stale')
    expect(detectTrainerChoiceState(malformed)).toMatchObject({
      status: 'invalid', pendingKinds: ['milestone-choice'],
    })
    expect(detectTrainerChoiceState({ ...exact, features: features(7) }))
      .toMatchObject({ status: 'invalid' })
  })

  it('resolves the Level-5 General Feature alternative only from an exact current canonical instance', () => {
    const featureRoute = trainer({
      level: 5,
      features: features(7),
      edges: levelFiveEdges(),
      bonusSkillEdges: 1,
      stats: statsWithSpent(14),
    })
    expect(detectTrainerChoiceState(featureRoute)).toMatchObject({
      status: 'none', countedFeatureRanks: 7, resolvedMilestones: 1,
      milestoneStatPointBudgetBonus: 0,
    })
    expect(detectTrainerChoiceState({ ...featureRoute, features: features(6) })).toMatchObject({
      status: 'pending', pendingKinds: ['milestone-choice'], resolvedMilestones: 0,
    })
  })

  it('resolves later milestone Edge and zero-immediate Stat alternatives without reading notes', () => {
    const edgeRoute = trainer({
      level: 10,
      features: features(9),
      edges: [skillEdge('athletics'), skillEdge('combat'), ...ordinaryEdges(11)],
      bonusSkillEdges: 2,
      stats: statsWithSpent(19),
    })
    expect(detectTrainerChoiceState(edgeRoute)).toMatchObject({
      status: 'none', reachedMilestones: 2, resolvedMilestones: 2,
      countedFeatureRanks: 9, countedEdgeRanks: 13,
    })

    const zeroImmediateStatRoute = trainer({
      level: 10,
      features: features(9),
      edges: [skillEdge('athletics'), skillEdge('combat'), ...ordinaryEdges(9)],
      bonusSkillEdges: 2,
      advancement: [{ level: 10, stats: 0, attack: 0, spAttack: 0, notes: 'not authority' }],
      stats: statsWithSpent(19),
    })
    expect(detectTrainerChoiceState(zeroImmediateStatRoute)).toMatchObject({
      status: 'none', reachedMilestones: 2, resolvedMilestones: 2,
      milestoneStatPointBudgetBonus: 0,
    })
  })

  it('fails closed for unresolved canonical subchoices, forged counters, and more than four Classes', () => {
    expect(detectTrainerChoiceState(trainer({ features: [{ name: 'Type Ace' }] }))).toMatchObject({
      status: 'invalid', pendingKinds: ['feature-configuration'],
    })
    expect(detectTrainerChoiceState(trainer({ edges: [{ name: 'Basic Skills' }] }))).toMatchObject({
      status: 'invalid', pendingKinds: ['edge-configuration'],
    })
    expect(detectTrainerChoiceState(trainer({ bonusSkillEdges: 1 }))).toMatchObject({ status: 'invalid' })
    expect(detectTrainerChoiceState(trainer({
      level: 3,
      features: ['Ace Trainer', 'Channeler', 'Cheerleader', 'Chef', 'Coordinator'].map(name => ({ name })),
      edges: ordinaryEdges(5),
      stats: statsWithSpent(12),
    }))).toMatchObject({ status: 'invalid' })
  })

  it('projects one privacy-minimal owner action and never copies class, Feature, Edge, Skill, or milestone options', () => {
    const document = trainer({ trainingFeature: undefined, features: [], edges: [], stats: statsWithSpent(0) })
    const before = JSON.stringify(document)
    const item = detectTrainerChoiceAttention({ stored: stored(document), campaignMinute: 900 })
    expect(item).toMatchObject({
      reason: 'trainer-advancement', audience: 'owner', urgency: 'normal',
      entity: { kind: 'trainer-sheet', id: 'ash' },
      authority: { kind: 'sheet', id: 'ash', revision: 7 },
      requiredDecision: { kind: 'review-trainer-build' },
      legalActions: [{
        intent: 'review-trainer',
        href: '/sheets/trainers/ash?attention=trainer-build',
        requiresConfirmation: false,
      }],
    })
    expect(JSON.stringify(item)).not.toMatch(/Focused Training|Ace Trainer|Acrobat|athletics|attack-special-attack/)
    expect(JSON.stringify(document)).toBe(before)
  })

  it('uses blocking repair semantics for malformed authority and suppresses fully resolved current sheets', () => {
    expect(detectTrainerChoiceAttention({
      stored: stored(trainer({ features: [{ name: 'not canonical' }] })), campaignMinute: 900,
    })).toMatchObject({ urgency: 'blocking', requiredDecision: { kind: 'review-trainer-build' } })
    expect(detectTrainerChoiceAttention({ stored: stored(), campaignMinute: 900 })).toBeNull()
  })

  it('requires complete bounded unique reads and ignores Pokémon sheets', () => {
    expect(projectCampaignTrainerChoiceAttention({
      sheets: [{ kind: 'pokemon', slug: 'sprig', revision: 1, updatedAt: 1, document: { slug: 'sprig' } }],
      campaignMinute: 0,
      completeness: { sheets: true },
    })).toEqual([])
    expect(() => projectCampaignTrainerChoiceAttention({
      sheets: [stored(), stored()], campaignMinute: 0, completeness: { sheets: true },
    })).toThrow('unique current sheet authority')
    expect(() => projectCampaignTrainerChoiceAttention({
      sheets: Array.from({ length: CAMPAIGN_TRAINER_CHOICE_ATTENTION_LIMIT + 1 }, () => stored()),
      campaignMinute: 0, completeness: { sheets: true },
    })).toThrow('at most 10000 current sheets')
  })
})
