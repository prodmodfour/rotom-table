import { applyCombatStageToStatTotal } from '~/utils/combatStageStats'
import { buildSheetAccuracySummary } from '~/utils/sheetAccuracy'
import { resolveStats, resolveCapabilities, resolveSkills } from '~/utils/sheets/pokemonDerived'
import { resolveTrainerCapabilities, resolveTrainerSkills, resolveTrainerStats } from '~/utils/sheets/trainerDerived'
import type { CharacterSheet, StatKey } from '~/types/characterSheet'
import type { TrainerSheet, TrainerSkillKey, TrainerStatKey } from '~/types/trainerSheet'
import {
  EQUIPMENT_CONTRIBUTION_SCHEMA_VERSION,
  type EquipmentContributionMetric,
  type EquipmentContributionProjectionV1,
  type EquipmentContributionProjectionValueV1,
} from '~~/shared/itemAutomation/equipmentContributions'
import type { EquipmentOwnerKind } from '~~/shared/itemAutomation/equipment'
import {
  equipmentContributionOwnerContext,
  resolveEquipmentContributions,
  resolveEquipmentMetric,
  type ResolvedEquipmentContribution,
} from './equipmentContributions'

const STAT_LABELS: Record<string, string> = {
  hp: 'HP', atk: 'Attack', def: 'Defense', satk: 'Special Attack',
  sdef: 'Special Defense', spd: 'Speed',
}
const SKILL_LABELS: Record<string, string> = {
  athletics: 'Athletics modifier', stealth: 'Stealth modifier',
  charm: 'Charm modifier', guile: 'Guile modifier', intimidate: 'Intimidate modifier',
}
const EVASION_LABELS: Record<string, string> = {
  physical: 'Physical Evasion', special: 'Special Evasion', speed: 'Speed Evasion',
}
const METRIC_LABELS: Record<EquipmentContributionMetric, string> = {
  'stat-after-stages': 'Stat',
  'combat-stage-default': 'Default Combat Stage',
  'skill-check-modifier': 'Skill modifier',
  'capability-value': 'Capability',
  evasion: 'Evasion',
  initiative: 'Initiative',
  'accuracy-roll': 'Accuracy rolls',
  'damage-reduction': 'Damage reduction',
  'direct-damage': 'Direct damage',
  'critical-range': 'Critical range',
}
const METRIC_ORDER: readonly EquipmentContributionMetric[] = [
  'stat-after-stages', 'combat-stage-default', 'skill-check-modifier',
  'capability-value', 'evasion', 'initiative', 'accuracy-roll',
  'damage-reduction', 'direct-damage', 'critical-range',
]

const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0

const pokemonSkillModifier = (sheet: CharacterSheet, key: string): number => {
  const value = resolveSkills(sheet).find(row => row.key === key)?.value ?? ''
  const match = /([+-]\d+)\s*$/u.exec(value.trim())
  return match?.[1] ? Number.parseInt(match[1], 10) : 0
}

const statValue = (
  kind: EquipmentOwnerKind,
  sheet: CharacterSheet | TrainerSheet,
  targetId: string,
): number => {
  if (kind === 'trainer') {
    const row = resolveTrainerStats(sheet as TrainerSheet).find(entry => entry.key === targetId as TrainerStatKey)
    if (!row) return 0
    return targetId === 'hp' ? row.baseTotal : applyCombatStageToStatTotal(row.key, row.baseTotal, row.stage)
  }
  const row = resolveStats(sheet as CharacterSheet).find(entry => entry.key === targetId as StatKey)
  if (!row) return 0
  return targetId === 'hp' ? row.baseTotal : applyCombatStageToStatTotal(row.key, row.baseTotal, row.stage)
}

const skillModifier = (
  kind: EquipmentOwnerKind,
  sheet: CharacterSheet | TrainerSheet,
  targetId: string,
): number => kind === 'trainer'
  ? resolveTrainerSkills(sheet as TrainerSheet).find(row => row.key === targetId as TrainerSkillKey)?.modifier ?? 0
  : pokemonSkillModifier(sheet as CharacterSheet, targetId)

const capabilityValue = (
  kind: EquipmentOwnerKind,
  sheet: CharacterSheet | TrainerSheet,
  targetId: string,
): number => {
  const rows = kind === 'trainer'
    ? resolveTrainerCapabilities(sheet as TrainerSheet).rows
    : resolveCapabilities(sheet as CharacterSheet).rows
  const row = rows.find(entry => entry.label.trim().toLocaleLowerCase('en-US') === targetId.toLocaleLowerCase('en-US'))
  return finite(row?.value)
}

const evasionValue = (
  kind: EquipmentOwnerKind,
  sheet: CharacterSheet | TrainerSheet,
  targetId: string,
): number => {
  if (kind === 'trainer') {
    const evasion = (sheet as TrainerSheet).evasion
    return targetId === 'physical' ? finite(evasion?.physicalBonus)
      : targetId === 'special' ? finite(evasion?.specialBonus)
        : finite(evasion?.speedBonus)
  }
  const evasion = (sheet as CharacterSheet).combat?.evasion
  return targetId === 'physical' ? finite(evasion?.vsAtkBonus)
    : targetId === 'special' ? finite(evasion?.vsSatkBonus)
      : finite(evasion?.vsAnyBonus)
}

const metricBase = (input: {
  readonly kind: EquipmentOwnerKind
  readonly sheet: CharacterSheet | TrainerSheet
  readonly metric: EquipmentContributionMetric
  readonly targetId: string
}): number => {
  if (input.metric === 'stat-after-stages') return statValue(input.kind, input.sheet, input.targetId)
  if (input.metric === 'combat-stage-default') return 0
  if (input.metric === 'skill-check-modifier') return skillModifier(input.kind, input.sheet, input.targetId)
  if (input.metric === 'capability-value') return capabilityValue(input.kind, input.sheet, input.targetId)
  if (input.metric === 'evasion') return evasionValue(input.kind, input.sheet, input.targetId)
  if (input.metric === 'initiative') return statValue(input.kind, input.sheet, 'spd')
  if (input.metric === 'accuracy-roll') {
    return buildSheetAccuracySummary({
      stage: input.kind === 'trainer'
        ? (input.sheet as TrainerSheet).combatStages?.acc
        : (input.sheet as CharacterSheet).combatStages?.acc,
      includeHeldItemBonus: false,
    }).total
  }
  if (input.metric === 'damage-reduction') {
    return input.kind === 'trainer' ? finite((input.sheet as TrainerSheet).damageReduction) : 0
  }
  return 0
}

const targetLabel = (metric: EquipmentContributionMetric, targetId: string): string => {
  if (metric === 'stat-after-stages') return STAT_LABELS[targetId] ?? targetId
  if (metric === 'combat-stage-default') return `${STAT_LABELS[targetId] ?? targetId} default stage`
  if (metric === 'skill-check-modifier') return SKILL_LABELS[targetId] ?? `${targetId} modifier`
  if (metric === 'capability-value') return targetId.charAt(0).toUpperCase() + targetId.slice(1)
  if (metric === 'evasion') return EVASION_LABELS[targetId] ?? 'Evasion'
  return METRIC_LABELS[metric]
}

const conditionSuffix = (contributions: readonly ResolvedEquipmentContribution[]): string => {
  const labels = [...new Set(contributions.flatMap(row => row.conditionLabels))]
  return labels.length > 0 ? ` · ${labels.join(', ')}` : ''
}

export const projectEquipmentContributionsForSheet = (input: {
  readonly kind: EquipmentOwnerKind
  readonly slug: string
  readonly sheet: CharacterSheet | TrainerSheet
}): EquipmentContributionProjectionV1 | null => {
  if (input.sheet.equipmentState === undefined) return null
  const sheet = { ...input.sheet } as CharacterSheet | TrainerSheet
  delete sheet.equipmentProjection
  delete sheet.equipmentContributionProjection
  const resolved = resolveEquipmentContributions({
    equipmentState: sheet.equipmentState,
    owner: equipmentContributionOwnerContext({
      kind: input.kind,
      slug: input.slug,
      sheet,
    }),
    includeContextual: true,
  })
  const keys = new Map<string, { metric: EquipmentContributionMetric; targetId: string }>()
  for (const contribution of resolved.active) {
    for (const targetId of contribution.targetIds) {
      const key = `${contribution.metric}:${targetId}`
      keys.set(key, { metric: contribution.metric, targetId })
    }
  }
  const values: EquipmentContributionProjectionValueV1[] = []
  for (const { metric, targetId } of keys.values()) {
    const matching = resolved.active.filter(row => row.metric === metric && row.targetIds.includes(targetId))
    const base = metricBase({ kind: input.kind, sheet, metric, targetId })
    const resolution = resolveEquipmentMetric({ contributions: matching, metric, targetId, base })
    values.push({
      metricId: `${metric}:${targetId}`,
      metric,
      targetId,
      label: `${targetLabel(metric, targetId)}${conditionSuffix(matching)}`,
      base,
      sources: resolution.contributions.map(source => ({
        sourceLabel: source.canonicalItemId,
        contributionId: source.contributionId,
        operation: source.operation,
        value: source.value,
        applied: source.applied,
        cap: source.cap,
        conditionLabels: matching.find(contribution => (
          contribution.contributionId === source.contributionId
          && contribution.instanceId === source.instanceId
        ))?.conditionLabels ?? [],
      })),
      final: resolution.final,
      conflict: resolution.conflict,
      unavailableReason: resolution.conflictReason,
    })
  }
  values.sort((left, right) => METRIC_ORDER.indexOf(left.metric) - METRIC_ORDER.indexOf(right.metric)
    || left.label.localeCompare(right.label))
  const equipmentRevision = sheet.equipmentState && typeof sheet.equipmentState === 'object'
    ? finite((sheet.equipmentState as { revision?: unknown }).revision)
    : 0
  const activeInstanceIds = new Set(resolved.active.map(row => row.instanceId))
  return {
    schemaVersion: EQUIPMENT_CONTRIBUTION_SCHEMA_VERSION,
    owner: { kind: input.kind, slug: input.slug },
    equipmentRevision,
    values,
    inactiveSourceCount: new Set(resolved.inactive
      .filter(row => !activeInstanceIds.has(row.instanceId))
      .map(row => row.instanceId)).size,
  }
}
