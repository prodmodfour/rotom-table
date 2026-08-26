import { createHash } from 'node:crypto'
import featuresJson from '../../../data/reference/features.json'
import edgesJson from '../../../data/reference/edges.json'
import itemsJson from '../../../data/reference/items.json'
import rulesJson from '../../../data/reference/rules.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { onboardingCreationCatalog } from '#shared/onboarding/catalog'
import { ONBOARDING_STAT_KEYS, type OnboardingStatKey, type OnboardingTrainerBuildV1 } from '#shared/onboarding/draft'
import { computeOnboardingSkillRanks } from '#shared/onboarding/preview'
import type { NpcArchetypePolicyV1 } from '#shared/gmToolkit/npcArchetypes'
import type { NpcGuidedDecisionsV1, NpcTrainerCandidateProjectionV1 } from '#shared/gmToolkit/npcGeneration'
import type { TrainerSheet, TrainerStatKey } from '~/types/trainerSheet'
import { computeTrainerFullMaxHp, resolveTrainerStats } from '~/utils/sheets/trainerDerived'
import type { GmToolkitSeededRng } from './seededRng'

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const sourceSha256 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const GM_NPC_GENERATION_SOURCE_DEFINITION_HASHES = Object.freeze([
  sourceSha256(featuresJson), sourceSha256(edgesJson), sourceSha256(itemsJson), sourceSha256(rulesJson),
].sort())

export interface ConstructedNpcTrainer {
  readonly candidateId: string
  readonly document: Omit<TrainerSheet, 'slug' | 'folder' | 'revision' | 'updatedAt' | 'currentTeam' | 'boxedPokemon'>
  readonly projection: NpcTrainerCandidateProjectionV1
  readonly definitionSha256: string
  readonly sourceDefinitionHashes: readonly string[]
}

export const constructNpcTrainer = (input: {
  readonly operationId: string
  readonly candidateId: string
  readonly archetype: NpcArchetypePolicyV1
  readonly guided: NpcGuidedDecisionsV1
  readonly rng: GmToolkitSeededRng
}): ConstructedNpcTrainer => {
  const catalog = onboardingCreationCatalog()
  const policy = input.archetype
  const level = policy.trainer.level
  const allocation: Record<OnboardingStatKey, number> = { hp: 0, atk: 0, def: 0, satk: 0, sdef: 0, spd: 0 }
  const budget = catalog.trainer.statBudget(level)
  for (let point = 0; point < budget; point += 1) allocation[policy.trainer.statPriority[point % policy.trainer.statPriority.length]!] += 1
  for (const milestone of policy.trainer.milestoneChoices) {
    for (const key of ONBOARDING_STAT_KEYS) allocation[key] += milestone.immediateAllocation[key] ?? 0
  }
  const base: Record<TrainerStatKey, number> = { hp: 10, atk: 5, def: 5, satk: 5, sdef: 5, spd: 5 }
  const stats = Object.fromEntries(ONBOARDING_STAT_KEYS.map(key => [key, { base: base[key], levelUp: allocation[key], stage: 0 }]))
  const featureRows = policy.trainer.features.map(feature => ({ name: feature.canonicalId, ...(Object.keys(feature.choices).length ? { choices: { ...feature.choices } } : {}) }))
  const edgeRows = policy.trainer.edges.map(edge => ({
    name: edge.canonicalId,
    ...(edge.canonicalId === 'Basic Skills' && edge.choices.skill ? { basicSkill: edge.choices.skill as never } : {}),
    ...(Object.keys(edge.choices).length ? { choices: { ...edge.choices } } : {}),
  }))
  const inventory = Object.fromEntries(policy.trainer.inventory.map(row => [row.section, [] as { name: string; qty: number }[]])) as NonNullable<TrainerSheet['inventory']>
  for (const row of policy.trainer.inventory) {
    const section = inventory[row.section] ?? []
    section.push({ name: row.itemId, qty: row.quantity })
    inventory[row.section] = section
  }
  const build: OnboardingTrainerBuildV1 = {
    name: input.guided.name,
    identity: { playedBy: null, age: null, sex: null, portraitUrl: null, accentColor: null, physicalDescription: null, background: null, personality: null, goalsAndDreams: null },
    statAllocation: allocation,
    background: policy.trainer.background,
    trainingFeatureId: policy.trainer.trainingFeatureId,
    features: policy.trainer.features.map((feature, index) => ({ entryId: `feature-${index + 1}`, canonicalId: feature.canonicalId, isClassAnchor: catalog.features.get(feature.canonicalId)?.isClass === true, choices: feature.choices })),
    edges: policy.trainer.edges.map((edge, index) => ({ entryId: `edge-${index + 1}`, canonicalId: edge.canonicalId, grantLevel: edge.grantLevel, choices: edge.choices })),
    milestoneChoices: policy.trainer.milestoneChoices,
  }
  const skillRanks = computeOnboardingSkillRanks(build)
  const sourceDefinitionHashes = [...GM_NPC_GENERATION_SOURCE_DEFINITION_HASHES]
  const draft: TrainerSheet = {
    slug: 'pending-npc-trainer',
    name: input.guided.name,
    level,
    player: false,
    money: policy.trainer.money,
    stats,
    currentInjuries: 0,
    injuriesHealedToday: 0,
    ap: { left: 5 + Math.floor(level / 5), spent: 0, bound: 0, drained: 0 },
    combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
    conditions: [],
    statusAfflictions: '',
    trainingFeature: policy.trainer.trainingFeatureId,
    skillBackground: {
      name: policy.trainer.background.name,
      adept: [...policy.trainer.background.adept],
      novice: [...policy.trainer.background.novice],
      pathetic: [...policy.trainer.background.pathetic],
    },
    skills: {},
    classes: policy.trainer.features.filter(feature => catalog.features.get(feature.canonicalId)?.isClass).map(feature => ({ name: feature.canonicalId })),
    features: featureRows,
    edges: edgeRows,
    inventory,
    remainingFeatures: 0,
    remainingEdges: 0,
    serverPrivate: {
      gmGeneration: {
        schemaVersion: 1,
        operationId: input.operationId,
        candidateId: input.candidateId,
        archetypeId: policy.archetypeId,
        archetypeRevision: policy.revision,
        sourceDefinitionHashes,
        seedCommitment: sha256({ algorithm: input.rng.algorithm, seed: input.rng.seed }),
        guided: { identity: input.guided.identity, tactics: input.guided.tactics, notes: input.guided.notes },
      },
    },
  }
  draft.currentHp = computeTrainerFullMaxHp(draft)
  const statTotals = Object.fromEntries(resolveTrainerStats(draft).map(row => [row.key, row.total])) as NpcTrainerCandidateProjectionV1['statTotals']
  const projection: NpcTrainerCandidateProjectionV1 = {
    candidateId: input.candidateId,
    name: input.guided.name,
    level,
    statTotals,
    skillRanks: Object.freeze(Object.fromEntries(Object.entries(skillRanks).map(([key, row]) => [key, row.rank]))),
    trainingFeatureId: policy.trainer.trainingFeatureId,
    featureNames: Object.freeze(policy.trainer.features.map(row => row.canonicalId)),
    edgeNames: Object.freeze(policy.trainer.edges.map(row => row.canonicalId)),
    money: policy.trainer.money,
    inventory: Object.freeze(policy.trainer.inventory.map(row => ({ ...row }))),
    guided: input.guided,
  }
  const { slug: _slug, folder: _folder, revision: _revision, updatedAt: _updatedAt, currentTeam: _team, boxedPokemon: _box, ...document } = draft
  return Object.freeze({ candidateId: input.candidateId, document: Object.freeze(document), projection: Object.freeze(projection), definitionSha256: sha256(document), sourceDefinitionHashes: Object.freeze(sourceDefinitionHashes) })
}
