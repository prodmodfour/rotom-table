import { edges, findEdge } from '~~/data/ptuReference'
import { TRAINER_SKILL_ORDER } from '~/utils/sheets/trainerSkillConstants'
import type { PtuEdge } from '~/types/ptuReference'
import type { TrainerEdgeEntry, TrainerSkillKey } from '~/types/trainerSheet'

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

const formatEdgeDataValue = (value: PtuEdge[TrainerEdgeDataField] | undefined): string => {
  if (Array.isArray(value)) return value.join(', ')
  if (value == null) return ''
  return value
}

export const trainerEdgeFieldValue = (
  edge: Pick<TrainerEdgeEntry, 'name'>,
  field: TrainerEdgeDataField,
): string => {
  if (field === 'name') return edge.name
  const reference = resolveTrainerEdgeReference(edge)
  if (!reference) return ''
  return formatEdgeDataValue(reference[field])
}
