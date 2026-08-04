import { edges, findEdge } from '~~/data/ptuReference'
import { TRAINER_SKILL_ORDER } from '~/utils/sheets/trainerSkillConstants'
import {
  trainerEdgeSubchoices,
  trainerSubchoiceDescriptionLines,
} from '~/utils/sheets/trainerSubchoices'
import type { PtuEdge } from '~/types/ptuReference'
import type { TrainerEdgeEntry, TrainerSheet, TrainerSkillKey } from '~/types/trainerSheet'
import { resolveEdgeInstance, type EdgeInstanceParameterStatus } from '#shared/edgeAutomation/instances'

export const TRAINER_EDGE_DATA_FIELDS = [
  'name',
  'tags',
  'prerequisites',
  'frequency',
  'trigger',
  'target',
  'condition',
  'effect',
] as const satisfies readonly (keyof PtuEdge)[]

export type TrainerEdgeDataField = (typeof TRAINER_EDGE_DATA_FIELDS)[number]
export type TrainerEdgeAutofillField = Exclude<TrainerEdgeDataField, 'name'>

export interface TrainerEdgeColumn<Field extends TrainerEdgeDataField = TrainerEdgeDataField> {
  key: Field
  label: string
  multiline?: boolean
}

export const TRAINER_EDGE_NAME_COLUMN: TrainerEdgeColumn<'name'> = {
  key: 'name',
  label: 'Edge',
}

export const TRAINER_EDGE_NAME_OPTIONS: readonly string[] = edges.map((edge) => edge.name)

export const BASIC_SKILLS_EDGE_NAME = 'Basic Skills'

export const TRAINER_EDGE_SKILL_OPTIONS = TRAINER_SKILL_ORDER.map(([value, label]) => ({ value, label }))

const trainerSkillLabels = new Map<TrainerSkillKey, string>(TRAINER_SKILL_ORDER)

export const trainerSkillLabel = (skill: string | null | undefined): string => {
  if (!skill) return ''
  return trainerSkillLabels.get(skill as TrainerSkillKey) ?? skill
}

export const isTrainerSkillKey = (value: unknown): value is TrainerSkillKey => (
  typeof value === 'string' && trainerSkillLabels.has(value as TrainerSkillKey)
)

export const TRAINER_EDGE_AUTOFILL_COLUMNS = [
  { key: 'tags', label: 'Tags', multiline: false },
  { key: 'prerequisites', label: 'Prerequisites', multiline: true },
  { key: 'frequency', label: 'Frequency', multiline: true },
  { key: 'trigger', label: 'Trigger', multiline: true },
  { key: 'target', label: 'Target', multiline: true },
  { key: 'condition', label: 'Condition', multiline: true },
  { key: 'effect', label: 'Effect', multiline: true },
] as const satisfies readonly TrainerEdgeColumn<TrainerEdgeAutofillField>[]

export const resolveTrainerEdgeReference = (edge: Pick<TrainerEdgeEntry, 'name'>): PtuEdge | null =>
  findEdge(edge.name)

export const isBasicSkillsEdge = (edge: Pick<TrainerEdgeEntry, 'name'>): boolean =>
  resolveTrainerEdgeReference(edge)?.name === BASIC_SKILLS_EDGE_NAME

/** Rebuild typed authority from setup-editor compatibility choices. */
export const syncTrainerEdgeAutomation = (
  sheet: TrainerSheet,
  edge: TrainerEdgeEntry,
  index: number,
): void => {
  const source = { ...edge, automation: undefined }
  const resolved = resolveEdgeInstance({ family: 'trainer', entry: source, ownerId: sheet.slug, index })
  if (resolved.status === 'ready' && resolved.data) {
    const next = { ...resolved.data, family: 'trainer' as const }
    if (JSON.stringify(edge.automation) !== JSON.stringify(next)) edge.automation = next
  }
  else delete edge.automation
}

export interface TrainerEdgeInspectorStatus {
  readonly status: EdgeInstanceParameterStatus
  readonly label: string
  readonly diagnostics: readonly string[]
}

export const trainerEdgeInspectorStatus = (
  sheet: TrainerSheet,
  edge: TrainerEdgeEntry,
  index: number,
): TrainerEdgeInspectorStatus => {
  const resolved = resolveEdgeInstance({ family: 'trainer', entry: edge, ownerId: sheet.slug, index })
  const labels: Readonly<Record<EdgeInstanceParameterStatus, string>> = {
    ready: 'Automated',
    'missing-required-data': 'Choice required',
    'unresolved-identity': 'No canonical identity',
    malformed: 'Invalid automation data',
  }
  return Object.freeze({ status: resolved.status, label: labels[resolved.status], diagnostics: resolved.diagnostics })
}

const formatEdgeDataValue = (value: PtuEdge[TrainerEdgeDataField] | undefined): string => {
  if (Array.isArray(value)) return value.join(', ')
  if (value == null) return ''
  return value
}

const appendEdgeSubchoiceDescriptions = (
  edge: Pick<TrainerEdgeEntry, 'name' | 'choices' | 'basicSkill'>,
  parentEffect: string,
): string => {
  const lines = trainerSubchoiceDescriptionLines(edge, trainerEdgeSubchoices(edge))
  return [parentEffect, ...lines].filter(Boolean).join('\n\n')
}

export const trainerEdgeFieldValue = (
  edge: Pick<TrainerEdgeEntry, 'name' | 'choices' | 'basicSkill'>,
  field: TrainerEdgeDataField,
): string => {
  if (field === 'name') return edge.name
  const reference = resolveTrainerEdgeReference(edge)
  if (!reference) return ''
  const value = formatEdgeDataValue(reference[field])
  return field === 'effect' ? appendEdgeSubchoiceDescriptions(edge, value) : value
}
