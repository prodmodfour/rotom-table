import { features, findFeature } from '~~/data/ptuReference'
import {
  trainerFeatureSubchoices,
  trainerSubchoiceDescriptionLines,
} from '~/utils/sheets/trainerSubchoices'
import type { PtuFeature } from '~/types/ptuReference'
import type { TrainerFeatureEntry } from '~/types/trainerSheet'

export const TRAINER_FEATURE_DATA_FIELDS = [
  'name',
  'tags',
  'prerequisites',
  'frequency',
  'trigger',
  'target',
  'condition',
  'effect',
  'className',
] as const satisfies readonly (keyof PtuFeature)[]

export type TrainerFeatureDataField = (typeof TRAINER_FEATURE_DATA_FIELDS)[number]
export type TrainerFeatureAutofillField = Exclude<TrainerFeatureDataField, 'name'>

export interface TrainerFeatureColumn<Field extends TrainerFeatureDataField = TrainerFeatureDataField> {
  key: Field
  label: string
  multiline?: boolean
}

export const TRAINER_FEATURE_NAME_COLUMN: TrainerFeatureColumn<'name'> = {
  key: 'name',
  label: 'Feature',
}

export const TRAINER_FEATURE_NAME_OPTIONS: readonly string[] = features.map((feature) => feature.name)

export const TRAINER_FEATURE_AUTOFILL_COLUMNS = [
  { key: 'tags', label: 'Tags', multiline: false },
  { key: 'prerequisites', label: 'Prerequisites', multiline: true },
  { key: 'frequency', label: 'Frequency', multiline: true },
  { key: 'trigger', label: 'Trigger', multiline: true },
  { key: 'target', label: 'Target', multiline: true },
  { key: 'condition', label: 'Condition', multiline: true },
  { key: 'effect', label: 'Effect', multiline: true },
  { key: 'className', label: 'Class Name', multiline: false },
] as const satisfies readonly TrainerFeatureColumn<TrainerFeatureAutofillField>[]

export const resolveTrainerFeatureReference = (feature: Pick<TrainerFeatureEntry, 'name'>): PtuFeature | null =>
  findFeature(feature.name)

const formatFeatureDataValue = (value: PtuFeature[TrainerFeatureDataField] | undefined): string => {
  if (Array.isArray(value)) return value.join(', ')
  if (value == null) return ''
  return value
}

const appendFeatureSubchoiceDescriptions = (
  feature: Pick<TrainerFeatureEntry, 'name' | 'choices'>,
  parentEffect: string,
): string => {
  const lines = trainerSubchoiceDescriptionLines(feature, trainerFeatureSubchoices(feature))
  return [parentEffect, ...lines].filter(Boolean).join('\n\n')
}

export const trainerFeatureFieldValue = (
  feature: Pick<TrainerFeatureEntry, 'name' | 'choices'>,
  field: TrainerFeatureDataField,
): string => {
  if (field === 'name') return feature.name
  const reference = resolveTrainerFeatureReference(feature)
  if (!reference) return ''
  const value = formatFeatureDataValue(reference[field])
  return field === 'effect' ? appendFeatureSubchoiceDescriptions(feature, value) : value
}
