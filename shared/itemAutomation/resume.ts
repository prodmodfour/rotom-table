import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'
import { ITEM_OPERATION_LIMITS, ITEM_OPERATION_SCHEMA_VERSION } from './operations'

export interface ResumeItemOperationCommandV1 {
  readonly schemaVersion: typeof ITEM_OPERATION_SCHEMA_VERSION
  readonly operationId: string
  readonly decisionId: string
  readonly choices: readonly { readonly choiceId: string, readonly optionIds: readonly string[] }[]
}

export class ItemResumeValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ItemResumeValidationError'
  }
}

const fail = (message: string): never => { throw new ItemResumeValidationError(message) }
const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > ITEM_OPERATION_LIMITS.identifierLength) {
    fail(`${label} must be a bounded non-empty identifier.`)
  }
  return value as string
}
const exact = (value: Record<string, unknown>, fields: readonly string[], label: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(field => !expected.has(field))) {
    fail(`${label} has an invalid shape.`)
  }
}

export const parseResumeItemOperationCommand = (value: unknown): ResumeItemOperationCommandV1 => {
  const cloned = cloneStrictJson(value, 'resumeItemOperation', {
    limits: {
      depth: 8,
      nodes: 2_048,
      objectFields: 8,
      arrayEntries: ITEM_OPERATION_LIMITS.optionsPerChoice,
      stringLength: ITEM_OPERATION_LIMITS.identifierLength,
      objectKeyLength: 100,
    },
    rootLabel: 'resume item operation',
    valueLabel: 'resume item operation commands',
    failNotJson: (_path, detail) => fail(detail),
    failLimit: (_path, detail) => fail(detail),
  })
  if (!isPlainJsonObject(cloned)) fail('Resume item operation must be an object.')
  const root = cloned as Record<string, unknown>
  exact(root, ['schemaVersion', 'operationId', 'decisionId', 'choices'], 'Resume item operation')
  if (root.schemaVersion !== ITEM_OPERATION_SCHEMA_VERSION) fail('Resume item operation schema version is unsupported.')
  if (!Array.isArray(root.choices) || root.choices.length > ITEM_OPERATION_LIMITS.choices) fail('Resume item choices are invalid.')
  const rawChoices = root.choices as unknown[]
  const choices = rawChoices.map((entry: unknown, index: number) => {
    if (!isPlainJsonObject(entry)) fail(`Resume item choice ${index} must be an object.`)
    const choice = entry as Record<string, unknown>
    exact(choice, ['choiceId', 'optionIds'], `Resume item choice ${index}`)
    if (!Array.isArray(choice.optionIds) || choice.optionIds.length > ITEM_OPERATION_LIMITS.optionsPerChoice) fail(`Resume item choice ${index} options are invalid.`)
    const optionIds = (choice.optionIds as unknown[]).map((entry: unknown, optionIndex: number) => text(entry, `Resume item choice ${index} option ${optionIndex}`))
    if (new Set(optionIds).size !== optionIds.length) fail(`Resume item choice ${index} repeats an option.`)
    return { choiceId: text(choice.choiceId, `Resume item choice ${index} ID`), optionIds }
  })
  if (new Set(choices.map(choice => choice.choiceId)).size !== choices.length) fail('Resume item choices repeat a choice identity.')
  return deepFreezeStrictJson({
    schemaVersion: ITEM_OPERATION_SCHEMA_VERSION,
    operationId: text(root.operationId, 'Resume item operation ID'),
    decisionId: text(root.decisionId, 'Resume item decision ID'),
    choices,
  })
}
