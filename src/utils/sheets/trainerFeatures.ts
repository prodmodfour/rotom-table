import { features, findFeature, toSlug } from '~~/data/ptuReference'
import {
  TRAINER_FREE_TRAINING_FEATURE_NAME,
  TRAINER_TRAINING_FEATURE_CHOICE_KEY,
  stripTrainerEntryChoiceSuffix,
  trainerFeatureSubchoices,
  trainerSubchoiceDescriptionLines,
  trainerSubchoiceValue,
} from '~/utils/sheets/trainerSubchoices'
import {
  POKEMON_TRAINING_FEATURE_OPTIONS,
  normalizePokemonTrainingFeatureName,
} from '~/utils/sheets/pokemonTrainingFeatures'
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

const TRAINER_FREE_TRAINING_FEATURE_TAGS = ['Orders', 'Training'] as const
const TRAINER_FREE_TRAINING_FEATURE_PREREQUISITES = 'Free trainer choice; prerequisites waived.'
const TRAINER_FREE_TRAINING_FEATURE_EMPTY_EFFECT = `Choose one free Training Feature: ${POKEMON_TRAINING_FEATURE_OPTIONS.join(', ')}.`

const isTrainerFreeTrainingFeatureEntry = (feature: Pick<TrainerFeatureEntry, 'name'>): boolean => (
  toSlug(stripTrainerEntryChoiceSuffix(feature.name)) === toSlug(TRAINER_FREE_TRAINING_FEATURE_NAME)
)

const selectedFreeTrainingFeatureName = (feature: Pick<TrainerFeatureEntry, 'name' | 'choices'>): string => {
  const definitions = trainerFeatureSubchoices(feature)
  const definition = definitions.find((candidate) => candidate.key === TRAINER_TRAINING_FEATURE_CHOICE_KEY)
  const rawValue = definition
    ? trainerSubchoiceValue(feature, definition, definitions)
    : feature.choices?.[TRAINER_TRAINING_FEATURE_CHOICE_KEY]
  return normalizePokemonTrainingFeatureName(rawValue) ?? ''
}

export const trainerFreeTrainingFeatureEntry = (trainingFeature: unknown): TrainerFeatureEntry => {
  const selectedFeature = normalizePokemonTrainingFeatureName(trainingFeature)
  return selectedFeature
    ? {
        name: TRAINER_FREE_TRAINING_FEATURE_NAME,
        choices: { [TRAINER_TRAINING_FEATURE_CHOICE_KEY]: selectedFeature },
      }
    : { name: TRAINER_FREE_TRAINING_FEATURE_NAME }
}

export const resolveTrainerFeatureReference = (feature: Pick<TrainerFeatureEntry, 'name' | 'choices'>): PtuFeature | null => {
  if (isTrainerFreeTrainingFeatureEntry(feature)) {
    const selectedFeature = selectedFreeTrainingFeatureName(feature)
    return selectedFeature ? findFeature(selectedFeature) : null
  }
  return findFeature(feature.name)
}

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

const trainerFreeTrainingFeatureFieldValue = (
  feature: Pick<TrainerFeatureEntry, 'name' | 'choices'>,
  field: TrainerFeatureDataField,
): string => {
  if (field === 'name') return TRAINER_FREE_TRAINING_FEATURE_NAME
  if (field === 'tags') return TRAINER_FREE_TRAINING_FEATURE_TAGS.join(', ')
  if (field === 'prerequisites') return TRAINER_FREE_TRAINING_FEATURE_PREREQUISITES

  const reference = resolveTrainerFeatureReference(feature)
  if (!reference) return field === 'effect' ? TRAINER_FREE_TRAINING_FEATURE_EMPTY_EFFECT : ''
  return formatFeatureDataValue(reference[field])
}

export const trainerFeatureFieldValue = (
  feature: Pick<TrainerFeatureEntry, 'name' | 'choices'>,
  field: TrainerFeatureDataField,
): string => {
  if (isTrainerFreeTrainingFeatureEntry(feature)) return trainerFreeTrainingFeatureFieldValue(feature, field)
  if (field === 'name') return feature.name
  const reference = resolveTrainerFeatureReference(feature)
  if (!reference) return ''
  const value = formatFeatureDataValue(reference[field])
  return field === 'effect' ? appendFeatureSubchoiceDescriptions(feature, value) : value
}
