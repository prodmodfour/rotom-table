import { edges, findEdge } from '~~/data/ptuReference'
import type { PtuEdge } from '~/types/ptuReference'
import type { TrainerEdgeEntry } from '~/types/trainerSheet'

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
