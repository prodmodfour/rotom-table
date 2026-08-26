import { onboardingCreationCatalog } from '../onboarding/catalog'
import {
  ONBOARDING_STAT_KEYS,
  ONBOARDING_TRAINER_SKILLS,
  type OnboardingBackgroundV1,
  type OnboardingEdgeEntryV1,
  type OnboardingFeatureEntryV1,
  type OnboardingMilestoneChoiceV1,
  type OnboardingStatKey,
  type OnboardingTrainerBuildV1,
  type OnboardingTrainerSkill,
} from '../onboarding/draft'
import { computeOnboardingSkillRanks } from '../onboarding/preview'
import { judgeFeaturePrerequisite } from '../onboarding/validate'
import { EDGE_PREREQUISITE_BY_KEY, evaluateEdgePrerequisite } from '../edgeAutomation/prerequisites'
import { canonicalEdgeKey } from '../edgeAutomation/catalog'

export const NPC_ARCHETYPE_SCHEMA_VERSION = 1 as const
export const NPC_ARCHETYPE_INVENTORY_SECTIONS = Object.freeze(['keyItems', 'pokemonItems', 'medicalKit', 'pokeBalls', 'foodStuff', 'equipment'] as const)
export type NpcArchetypeInventorySection = typeof NPC_ARCHETYPE_INVENTORY_SECTIONS[number]

export interface NpcArchetypeFeatureV1 {
  readonly canonicalId: string
  readonly choices: Readonly<Record<string, string>>
}
export interface NpcArchetypeEdgeV1 {
  readonly canonicalId: string
  readonly grantLevel: number | null
  readonly choices: Readonly<Record<string, string>>
}
export interface NpcArchetypePolicyV1 {
  readonly schemaVersion: 1
  readonly archetypeId: string
  readonly revision: number
  readonly status: 'active' | 'archived'
  readonly name: string
  readonly description: string
  readonly trainer: {
    readonly level: number
    readonly statPriority: readonly OnboardingStatKey[]
    readonly background: OnboardingBackgroundV1
    readonly trainingFeatureId: string
    readonly features: readonly NpcArchetypeFeatureV1[]
    readonly edges: readonly NpcArchetypeEdgeV1[]
    readonly milestoneChoices: readonly OnboardingMilestoneChoiceV1[]
    readonly money: number
    readonly inventory: readonly { readonly section: NpcArchetypeInventorySection; readonly itemId: string; readonly quantity: number }[]
  }
  readonly roster: {
    readonly tableId: string
    readonly expectedTableRevision: number
    readonly count: number
    readonly shinyChancePercent: number
    readonly heldItemName: string | null
  }
  readonly guidedDecisions: {
    readonly requireName: true
    readonly identityPrompt: string
    readonly tacticsPrompt: string
    readonly notesPrompt: string
  }
  readonly provenance: {
    readonly kind: 'campaign-authored' | 'reviewed-seed'
    readonly sourceId: string | null
    readonly sourceSha256: string | null
  }
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NpcArchetypeLibraryProjectionV1 {
  readonly schemaVersion: 1
  readonly archetypeId: string
  readonly revision: number
  readonly status: 'active' | 'archived'
  readonly name: string
  readonly description: string
  readonly trainerLevel: number
  readonly rosterCount: number
  readonly updatedAt: string
}

export class NpcArchetypeContractError extends Error {
  readonly path: string
  constructor(path: string, message: string) { super(`${path}: ${message}`); this.name = 'NpcArchetypeContractError'; this.path = path }
}
const fail = (path: string, message: string): never => { throw new NpcArchetypeContractError(path, message) }
const object = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(path, 'must be an object')
  return value as Record<string, unknown>
}
const exact = (row: Record<string, unknown>, keys: readonly string[], path: string): void => {
  const expected = new Set(keys)
  if (Object.keys(row).length !== expected.size || Object.keys(row).some(key => !expected.has(key))) fail(path, 'has unsupported or missing fields')
}
const integer = (value: unknown, path: string, min: number, max: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) return fail(path, `must be an integer from ${min} to ${max}`)
  return Number(value)
}
const text = (value: unknown, path: string, max: number, allowEmpty = false): string => {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && value.trim().length === 0) || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return fail(path, `must be ${allowEmpty ? 'bounded' : 'non-empty bounded'} text`)
  return value
}
const iso = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return fail(path, 'must be a normalized ISO instant')
  return value
}
const choices = (value: unknown, path: string): Readonly<Record<string, string>> => {
  const row = object(value, path)
  if (Object.keys(row).length > 12) return fail(path, 'must contain at most 12 choices')
  return Object.freeze(Object.fromEntries(Object.keys(row).sort().map(key => [text(key, `${path}.key`, 60), text(row[key], `${path}.${key}`, 160)])))
}
const unique = <T extends string>(values: readonly T[], path: string): readonly T[] => {
  if (new Set(values).size !== values.length) return fail(path, 'must not repeat values')
  return values
}

const parseBackground = (value: unknown, path: string): OnboardingBackgroundV1 => {
  const row = object(value, path)
  exact(row, ['name', 'adept', 'novice', 'pathetic'], path)
  const skillList = (raw: unknown, field: string): readonly OnboardingTrainerSkill[] => {
    if (!Array.isArray(raw)) return fail(field, 'must be an array')
    return unique(raw.map((entry, index) => {
      if (!(ONBOARDING_TRAINER_SKILLS as readonly unknown[]).includes(entry)) return fail(`${field}[${index}]`, 'must be a canonical Trainer skill')
      return entry as OnboardingTrainerSkill
    }), field)
  }
  const background = { name: text(row.name, `${path}.name`, 120), adept: skillList(row.adept, `${path}.adept`), novice: skillList(row.novice, `${path}.novice`), pathetic: skillList(row.pathetic, `${path}.pathetic`) }
  const mechanics = onboardingCreationCatalog().trainer.background
  if (background.adept.length !== mechanics.adeptPicks || background.novice.length !== mechanics.novicePicks || background.pathetic.length !== mechanics.patheticPicks) {
    return fail(path, `must contain exactly ${mechanics.adeptPicks} Adept, ${mechanics.novicePicks} Novice, and ${mechanics.patheticPicks} Pathetic picks`)
  }
  unique([...background.adept, ...background.novice, ...background.pathetic], path)
  return Object.freeze(background)
}

const parseFeatures = (value: unknown, path: string): readonly NpcArchetypeFeatureV1[] => {
  if (!Array.isArray(value) || value.length > 30) return fail(path, 'must be an array of at most 30 Features')
  const rows = value.map((entry, index) => {
    const row = object(entry, `${path}[${index}]`); exact(row, ['canonicalId', 'choices'], `${path}[${index}]`)
    return Object.freeze({ canonicalId: text(row.canonicalId, `${path}[${index}].canonicalId`, 160), choices: choices(row.choices, `${path}[${index}].choices`) })
  })
  unique(rows.map(row => row.canonicalId), path)
  return Object.freeze(rows)
}
const parseEdges = (value: unknown, path: string): readonly NpcArchetypeEdgeV1[] => {
  if (!Array.isArray(value) || value.length > 30) return fail(path, 'must be an array of at most 30 Edges')
  const rows = value.map((entry, index) => {
    const row = object(entry, `${path}[${index}]`); exact(row, ['canonicalId', 'grantLevel', 'choices'], `${path}[${index}]`)
    return Object.freeze({
      canonicalId: text(row.canonicalId, `${path}[${index}].canonicalId`, 160),
      grantLevel: row.grantLevel === null ? null : integer(row.grantLevel, `${path}[${index}].grantLevel`, 1, 50),
      choices: choices(row.choices, `${path}[${index}].choices`),
    })
  })
  if (new Set(rows.map(row => `${row.canonicalId}:${JSON.stringify(row.choices)}`)).size !== rows.length) return fail(path, 'must not repeat the same Edge and choices')
  return Object.freeze(rows)
}

const validateTrainerLegality = (policy: NpcArchetypePolicyV1): void => {
  const catalog = onboardingCreationCatalog()
  const level = policy.trainer.level
  if (policy.trainer.features.length !== catalog.trainer.paidFeatureSlots(level)) fail('archetype.trainer.features', `must spend exactly ${catalog.trainer.paidFeatureSlots(level)} Feature slots at Level ${level}`)
  const normalEdges = policy.trainer.edges.filter(edge => edge.grantLevel === null)
  const bonusEdges = policy.trainer.edges.filter(edge => edge.grantLevel !== null)
  if (normalEdges.length !== catalog.trainer.edgeSlots(level)) fail('archetype.trainer.edges', `must spend exactly ${catalog.trainer.edgeSlots(level)} normal Edge slots at Level ${level}`)
  if (bonusEdges.length !== catalog.trainer.bonusSkillEdgeSlots(level)) fail('archetype.trainer.edges', `must spend exactly ${catalog.trainer.bonusSkillEdgeSlots(level)} bonus Skill Edge slots at Level ${level}`)
  if (!catalog.trainer.entitlements.freeTrainingFeatureIds.includes(policy.trainer.trainingFeatureId)) fail('archetype.trainer.trainingFeatureId', 'must be a canonical free Training Feature')

  for (const feature of policy.trainer.features) if (!catalog.features.has(feature.canonicalId)) fail('archetype.trainer.features', `unknown canonical Feature ${feature.canonicalId}`)
  for (const edge of policy.trainer.edges) if (!catalog.edges.has(edge.canonicalId)) fail('archetype.trainer.edges', `unknown canonical Edge ${edge.canonicalId}`)
  for (const item of policy.trainer.inventory) if (!catalog.items.has(item.itemId)) fail('archetype.trainer.inventory', `unknown canonical item ${item.itemId}`)

  const featureEntries: OnboardingFeatureEntryV1[] = policy.trainer.features.map((feature, index) => ({
    entryId: `feature-${index + 1}`, canonicalId: feature.canonicalId,
    isClassAnchor: catalog.features.get(feature.canonicalId)?.isClass === true, choices: feature.choices,
  }))
  const edgeEntries: OnboardingEdgeEntryV1[] = policy.trainer.edges.map((edge, index) => ({ entryId: `edge-${index + 1}`, ...edge }))
  const build: OnboardingTrainerBuildV1 = {
    name: 'NPC', identity: { playedBy: null, age: null, sex: null, portraitUrl: null, accentColor: null, physicalDescription: null, background: null, personality: null, goalsAndDreams: null },
    statAllocation: { hp: 0, atk: 0, def: 0, satk: 0, sdef: 0, spd: 0 }, background: policy.trainer.background,
    trainingFeatureId: policy.trainer.trainingFeatureId, features: featureEntries, edges: edgeEntries, milestoneChoices: policy.trainer.milestoneChoices,
  }
  const skillRows = computeOnboardingSkillRanks(build)
  const skillRanks = Object.fromEntries(ONBOARDING_TRAINER_SKILLS.map(skill => [skill, skillRows[skill].value]))
  const featureIds = new Set([policy.trainer.trainingFeatureId, ...policy.trainer.features.map(feature => feature.canonicalId)])
  const featureClassCounts: Record<string, number> = {}
  for (const feature of policy.trainer.features) {
    const className = catalog.features.get(feature.canonicalId)?.className
    if (className) featureClassCounts[className] = (featureClassCounts[className] ?? 0) + 1
  }
  const featureContext = { level, skillRanks, featureIds, edgeIds: new Set(policy.trainer.edges.map(edge => edge.canonicalId)), featureClassCounts }
  for (const featureId of featureIds) {
    const verdict = judgeFeaturePrerequisite(featureId, featureContext)
    if (verdict.kind !== 'satisfied') fail('archetype.trainer.features', `${featureId} prerequisite is ${verdict.kind === 'needs-clause' ? 'not structurally approved' : `unmet: ${verdict.unmetLabels.join('; ')}`}`)
  }
  const edgeKeys = new Set(policy.trainer.edges.map(edge => canonicalEdgeKey('trainer', edge.canonicalId)))
  for (const edge of policy.trainer.edges) {
    const canonical = catalog.edges.get(edge.canonicalId)!
    if (edge.grantLevel !== null && (!canonical.isSkillEdge || !catalog.trainer.entitlements.bonusSkillEdgeLevels.includes(edge.grantLevel) || edge.grantLevel > level)) fail('archetype.trainer.edges', `${edge.canonicalId} cannot use bonus slot Level ${edge.grantLevel}`)
    if (EDGE_PREREQUISITE_BY_KEY.has(canonicalEdgeKey('trainer', edge.canonicalId))) {
      const verdict = evaluateEdgePrerequisite('trainer', edge.canonicalId, { level, skillRanks, effectiveEdgeKeys: edgeKeys })
      if (!verdict.eligible) fail('archetype.trainer.edges', `${edge.canonicalId} prerequisite is unmet: ${verdict.unmet.join('; ')}`)
    }
  }
  const milestones = catalog.trainer.milestonesForLevel(level)
  if (policy.trainer.milestoneChoices.length !== milestones.length) fail('archetype.trainer.milestoneChoices', `must resolve all ${milestones.length} milestone choices`)
  for (const milestone of milestones) {
    const choice = policy.trainer.milestoneChoices.find(row => row.level === milestone.level)
      ?? fail('archetype.trainer.milestoneChoices', `Level ${milestone.level} choice is missing or invalid`)
    const option = milestone.options.find(row => row.id === choice.optionId)
      ?? fail('archetype.trainer.milestoneChoices', `Level ${milestone.level} choice is missing or invalid`)
    const spent = ONBOARDING_STAT_KEYS.reduce((sum, key) => sum + (choice.immediateAllocation[key] ?? 0), 0)
    if (spent !== (option.immediatePoints ?? 0)) fail('archetype.trainer.milestoneChoices', `Level ${milestone.level} immediate allocation is invalid`)
    if (option.id === 'attack-special-attack' && ONBOARDING_STAT_KEYS.some(key => !['atk', 'satk'].includes(key) && (choice.immediateAllocation[key] ?? 0) > 0)) fail('archetype.trainer.milestoneChoices', 'attack-special-attack points must stay in Attack stats')
  }
}

export const parseNpcArchetypePolicyV1 = (value: unknown): NpcArchetypePolicyV1 => {
  const root = object(value, 'archetype')
  exact(root, ['schemaVersion', 'archetypeId', 'revision', 'status', 'name', 'description', 'trainer', 'roster', 'guidedDecisions', 'provenance', 'createdAt', 'updatedAt'], 'archetype')
  if (root.schemaVersion !== 1 || (root.status !== 'active' && root.status !== 'archived')) fail('archetype', 'must be a supported schema-v1 policy')
  const archetypeId = text(root.archetypeId, 'archetype.archetypeId', 160)
  if (!/^npc-archetype:v1:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(archetypeId)) fail('archetype.archetypeId', 'must be a stable NPC archetype ID')
  const trainer = object(root.trainer, 'archetype.trainer')
  exact(trainer, ['level', 'statPriority', 'background', 'trainingFeatureId', 'features', 'edges', 'milestoneChoices', 'money', 'inventory'], 'archetype.trainer')
  if (!Array.isArray(trainer.statPriority) || trainer.statPriority.length !== ONBOARDING_STAT_KEYS.length || trainer.statPriority.some(value => !(ONBOARDING_STAT_KEYS as readonly unknown[]).includes(value))) fail('archetype.trainer.statPriority', 'must order all six Trainer stats exactly once')
  const statPriority = unique(trainer.statPriority as OnboardingStatKey[], 'archetype.trainer.statPriority')
  if (!Array.isArray(trainer.milestoneChoices)) fail('archetype.trainer.milestoneChoices', 'must be an array')
  const milestoneChoices = (trainer.milestoneChoices as unknown[]).map((entry: unknown, index: number): OnboardingMilestoneChoiceV1 => {
    const row = object(entry, `archetype.trainer.milestoneChoices[${index}]`); exact(row, ['level', 'optionId', 'immediateAllocation'], `archetype.trainer.milestoneChoices[${index}]`)
    const allocation = object(row.immediateAllocation, `archetype.trainer.milestoneChoices[${index}].immediateAllocation`)
    if (Object.keys(allocation).some(key => !(ONBOARDING_STAT_KEYS as readonly string[]).includes(key))) fail(`archetype.trainer.milestoneChoices[${index}].immediateAllocation`, 'contains an unknown stat')
    return Object.freeze({ level: integer(row.level, `archetype.trainer.milestoneChoices[${index}].level`, 1, 50), optionId: text(row.optionId, `archetype.trainer.milestoneChoices[${index}].optionId`, 80), immediateAllocation: Object.freeze(Object.fromEntries(Object.entries(allocation).map(([key, raw]) => [key, integer(raw, `allocation.${key}`, 0, 20)]))) })
  })
  if (!Array.isArray(trainer.inventory) || trainer.inventory.length > 60) fail('archetype.trainer.inventory', 'must be an array of at most 60 rows')
  const inventory = (trainer.inventory as unknown[]).map((entry: unknown, index: number) => {
    const row = object(entry, `archetype.trainer.inventory[${index}]`); exact(row, ['section', 'itemId', 'quantity'], `archetype.trainer.inventory[${index}]`)
    if (!(NPC_ARCHETYPE_INVENTORY_SECTIONS as readonly unknown[]).includes(row.section)) fail(`archetype.trainer.inventory[${index}].section`, 'is unknown')
    return Object.freeze({ section: row.section as NpcArchetypeInventorySection, itemId: text(row.itemId, `archetype.trainer.inventory[${index}].itemId`, 120), quantity: integer(row.quantity, `archetype.trainer.inventory[${index}].quantity`, 1, 99) })
  })
  const roster = object(root.roster, 'archetype.roster'); exact(roster, ['tableId', 'expectedTableRevision', 'count', 'shinyChancePercent', 'heldItemName'], 'archetype.roster')
  const tableId = text(roster.tableId, 'archetype.roster.tableId', 160)
  if (!/^encounter-table:v1:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tableId)) fail('archetype.roster.tableId', 'must be a stable encounter table ID')
  const shinyChancePercent = Number(roster.shinyChancePercent)
  if (!Number.isFinite(shinyChancePercent) || shinyChancePercent < 0 || shinyChancePercent > 100 || Math.round(shinyChancePercent * 100) !== shinyChancePercent * 100) fail('archetype.roster.shinyChancePercent', 'must be 0..100 with at most two decimals')
  const guided = object(root.guidedDecisions, 'archetype.guidedDecisions'); exact(guided, ['requireName', 'identityPrompt', 'tacticsPrompt', 'notesPrompt'], 'archetype.guidedDecisions')
  if (guided.requireName !== true) fail('archetype.guidedDecisions.requireName', 'must require an explicit GM-authored name')
  const provenance = object(root.provenance, 'archetype.provenance'); exact(provenance, ['kind', 'sourceId', 'sourceSha256'], 'archetype.provenance')
  if (provenance.kind !== 'campaign-authored' && provenance.kind !== 'reviewed-seed') fail('archetype.provenance.kind', 'is unknown')
  const sourceSha256 = provenance.sourceSha256 === null ? null : text(provenance.sourceSha256, 'archetype.provenance.sourceSha256', 64)
  if (sourceSha256 !== null && !/^[a-f0-9]{64}$/.test(sourceSha256)) fail('archetype.provenance.sourceSha256', 'must be SHA-256')
  const heldItemName = roster.heldItemName === null ? null : text(roster.heldItemName, 'archetype.roster.heldItemName', 120)
  const policy: NpcArchetypePolicyV1 = {
    schemaVersion: 1, archetypeId, revision: integer(root.revision, 'archetype.revision', 0, Number.MAX_SAFE_INTEGER), status: root.status as 'active' | 'archived',
    name: text(root.name, 'archetype.name', 120), description: text(root.description, 'archetype.description', 1000, true),
    trainer: {
      level: integer(trainer.level, 'archetype.trainer.level', 1, onboardingCreationCatalog().trainer.entitlements.maximumLevel), statPriority,
      background: parseBackground(trainer.background, 'archetype.trainer.background'), trainingFeatureId: text(trainer.trainingFeatureId, 'archetype.trainer.trainingFeatureId', 160),
      features: parseFeatures(trainer.features, 'archetype.trainer.features'), edges: parseEdges(trainer.edges, 'archetype.trainer.edges'), milestoneChoices: Object.freeze(milestoneChoices),
      money: integer(trainer.money, 'archetype.trainer.money', 0, 1_000_000), inventory: Object.freeze(inventory),
    },
    roster: { tableId, expectedTableRevision: integer(roster.expectedTableRevision, 'archetype.roster.expectedTableRevision', 0, Number.MAX_SAFE_INTEGER), count: integer(roster.count, 'archetype.roster.count', 0, 6), shinyChancePercent, heldItemName },
    guidedDecisions: { requireName: true, identityPrompt: text(guided.identityPrompt, 'archetype.guidedDecisions.identityPrompt', 240), tacticsPrompt: text(guided.tacticsPrompt, 'archetype.guidedDecisions.tacticsPrompt', 240), notesPrompt: text(guided.notesPrompt, 'archetype.guidedDecisions.notesPrompt', 240) },
    provenance: { kind: provenance.kind as 'campaign-authored' | 'reviewed-seed', sourceId: provenance.sourceId === null ? null : text(provenance.sourceId, 'archetype.provenance.sourceId', 200), sourceSha256 },
    createdAt: iso(root.createdAt, 'archetype.createdAt'), updatedAt: iso(root.updatedAt, 'archetype.updatedAt'),
  }
  if (Date.parse(policy.updatedAt) < Date.parse(policy.createdAt)) fail('archetype.updatedAt', 'must not precede creation')
  validateTrainerLegality(policy)
  return Object.freeze(policy)
}

export const projectNpcArchetypeForLibrary = (policy: NpcArchetypePolicyV1): NpcArchetypeLibraryProjectionV1 => Object.freeze({
  schemaVersion: 1, archetypeId: policy.archetypeId, revision: policy.revision, status: policy.status, name: policy.name,
  description: policy.description, trainerLevel: policy.trainer.level, rosterCount: policy.roster.count, updatedAt: policy.updatedAt,
})
