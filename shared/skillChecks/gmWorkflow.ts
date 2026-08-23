import { parsePlayerProfileId } from '../playerProfiles'
import { isSlug } from '../paths'
import {
  SKILL_CHECK_OPERATION_KINDS,
  SKILL_CHECK_SKILL_IDS,
  SKILL_CHECK_STATES,
  parseSkillCheckId,
  parseSkillCheckOperationId,
  type SkillCheckDocumentV1,
  type SkillCheckOperationKind,
  type SkillCheckState,
} from './contract'
import { SKILL_CHECK_DC_PRESETS, type SkillCheckDcPresetV1 } from './difficulty'
import { parseSkillCheckDocument } from './persistence'

export interface SkillCheckGmSubjectOptionV1 {
  readonly kind: 'trainer' | 'pokemon'
  readonly sheetSlug: string
  readonly sheetRevision: number
  readonly label: string
  readonly controllerProfileIds: readonly string[]
  readonly skillIds: typeof SKILL_CHECK_SKILL_IDS
}

export interface SkillCheckGmCommandReceiptV1 {
  readonly schemaVersion: 1
  readonly operationId: `skill-check-op:v1:${string}`
  readonly checkId: `skill-check:v1:${string}`
  readonly commandKind: Extract<SkillCheckOperationKind, 'request' | 'cancel' | 'resolve'>
  readonly revision: number
  readonly state: SkillCheckState
  readonly updatedAt: number
  readonly exactReplay: boolean
}

export interface LoadGmSkillChecksResponseV1 {
  readonly schemaVersion: 1
  readonly checks: readonly SkillCheckDocumentV1[]
  readonly subjects: readonly SkillCheckGmSubjectOptionV1[]
  readonly dcPresets: readonly SkillCheckDcPresetV1[]
}

export interface ManageGmSkillCheckResponseV1 {
  readonly schemaVersion: 1
  readonly receipt: SkillCheckGmCommandReceiptV1
  readonly document: SkillCheckDocumentV1
}

const fail = (path: string): never => { throw new Error(`skill-check.invalid-gm-workflow-response:${path}`) }
const row = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path)
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, fields: readonly string[], path: string): void => {
  if (Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) fail(path)
}
const safeInteger = (value: unknown, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) return fail('integer')
  return Number(value)
}
const boundedText = (value: unknown, maximum: number, path: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) return fail(path)
  return value
}
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

const parseSubjectOption = (value: unknown, index: number): SkillCheckGmSubjectOptionV1 => {
  const path = `subjects[${index}]`
  const candidate = row(value, path)
  exact(candidate, ['kind', 'sheetSlug', 'sheetRevision', 'label', 'controllerProfileIds', 'skillIds'], path)
  if (candidate.kind !== 'trainer' && candidate.kind !== 'pokemon') return fail(`${path}.kind`)
  if (!isSlug(candidate.sheetSlug)) return fail(`${path}.sheetSlug`)
  safeInteger(candidate.sheetRevision)
  boundedText(candidate.label, 120, `${path}.label`)
  if (!Array.isArray(candidate.controllerProfileIds) || candidate.controllerProfileIds.length > 32) {
    return fail(`${path}.controllerProfileIds`)
  }
  const controllerProfileIds = candidate.controllerProfileIds.map((profileId, controllerIndex) => (
    String(parsePlayerProfileId(profileId, `${path}.controllerProfileIds[${controllerIndex}]`))
  ))
  if (new Set(controllerProfileIds).size !== controllerProfileIds.length) return fail(`${path}.controllerProfileIds`)
  if (!Array.isArray(candidate.skillIds)
    || candidate.skillIds.length !== SKILL_CHECK_SKILL_IDS.length
    || candidate.skillIds.some((skillId, skillIndex) => skillId !== SKILL_CHECK_SKILL_IDS[skillIndex])) {
    return fail(`${path}.skillIds`)
  }
  return candidate as unknown as SkillCheckGmSubjectOptionV1
}

const parsePresets = (value: unknown): readonly SkillCheckDcPresetV1[] => {
  if (!Array.isArray(value) || value.length !== SKILL_CHECK_DC_PRESETS.length) return fail('dcPresets')
  for (const [index, preset] of value.entries()) {
    const expected = SKILL_CHECK_DC_PRESETS[index]!
    const candidate = row(preset, `dcPresets[${index}]`)
    exact(candidate, ['presetId', 'label', 'difficultyClass', 'guidance'], `dcPresets[${index}]`)
    if (candidate.presetId !== expected.presetId || candidate.label !== expected.label
      || candidate.difficultyClass !== expected.difficultyClass || candidate.guidance !== expected.guidance) {
      return fail(`dcPresets[${index}]`)
    }
  }
  return value as SkillCheckDcPresetV1[]
}

const parseReceipt = (value: unknown): SkillCheckGmCommandReceiptV1 => {
  const candidate = row(value, 'receipt')
  exact(candidate, ['schemaVersion', 'operationId', 'checkId', 'commandKind', 'revision', 'state', 'updatedAt', 'exactReplay'], 'receipt')
  if (candidate.schemaVersion !== 1
    || !['request', 'cancel', 'resolve'].includes(String(candidate.commandKind))
    || !SKILL_CHECK_OPERATION_KINDS.includes(candidate.commandKind as never)
    || !SKILL_CHECK_STATES.includes(candidate.state as never)
    || typeof candidate.exactReplay !== 'boolean') return fail('receipt')
  parseSkillCheckOperationId(candidate.operationId)
  parseSkillCheckId(candidate.checkId)
  safeInteger(candidate.revision, 1)
  safeInteger(candidate.updatedAt)
  return candidate as unknown as SkillCheckGmCommandReceiptV1
}

export const parseLoadGmSkillChecksResponse = (value: unknown): LoadGmSkillChecksResponseV1 => {
  const candidate = structuredClone(row(value, 'response'))
  exact(candidate, ['schemaVersion', 'checks', 'subjects', 'dcPresets'], 'response')
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.checks) || candidate.checks.length > 500
    || !Array.isArray(candidate.subjects) || candidate.subjects.length > 10_000) return fail('response')
  const checks = candidate.checks.map(parseSkillCheckDocument)
  const subjects = candidate.subjects.map(parseSubjectOption)
  if (new Set(subjects.map(subject => `${subject.kind}:${subject.sheetSlug}`)).size !== subjects.length) {
    return fail('subjects')
  }
  candidate.checks = checks
  candidate.subjects = subjects
  candidate.dcPresets = parsePresets(candidate.dcPresets)
  return deepFreeze(candidate as unknown as LoadGmSkillChecksResponseV1)
}

export const parseManageGmSkillCheckResponse = (value: unknown): ManageGmSkillCheckResponseV1 => {
  const candidate = structuredClone(row(value, 'response'))
  exact(candidate, ['schemaVersion', 'receipt', 'document'], 'response')
  if (candidate.schemaVersion !== 1) return fail('response.schemaVersion')
  const receipt = parseReceipt(candidate.receipt)
  const document = parseSkillCheckDocument(candidate.document)
  const receiptStateIsValid = receipt.commandKind === 'request'
    ? receipt.revision === 1 && receipt.state === 'pending'
    : receipt.commandKind === 'cancel'
      ? receipt.revision >= 2 && receipt.state === 'cancelled'
      : receipt.revision >= 2 && receipt.state === 'accepted'
  if (!receiptStateIsValid
    || receipt.checkId !== document.checkId
    || receipt.revision > document.revision
    || receipt.updatedAt > document.updatedAt
    || (receipt.revision === document.revision
      && (receipt.state !== document.state || receipt.updatedAt !== document.updatedAt))) return fail('response.authority')
  return deepFreeze({ schemaVersion: 1, receipt, document })
}
