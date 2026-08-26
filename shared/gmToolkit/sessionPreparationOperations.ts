import {
  parseSessionPreparationDocumentV1,
  type SessionPreparationDecisionV1,
  type SessionPreparationHandoutV1,
  type SessionPreparationSceneV1,
} from './sessionPreparation'

export interface SessionPreparationContentV1 {
  readonly title: string
  readonly scheduledFor: string | null
  readonly playerOverview: string
  readonly gmNotes: string
  readonly scenes: readonly SessionPreparationSceneV1[]
  readonly handouts: readonly SessionPreparationHandoutV1[]
  readonly unresolvedDecisions: readonly SessionPreparationDecisionV1[]
}
export interface CreateSessionPreparationCommandV1 { readonly schemaVersion: 1; readonly kind: 'create'; readonly operationId: string; readonly title: string; readonly scheduledFor: string | null }
export interface SaveSessionPreparationCommandV1 { readonly schemaVersion: 1; readonly kind: 'save'; readonly operationId: string; readonly preparationId: string; readonly expectedRevision: number; readonly content: SessionPreparationContentV1 }
export interface TransitionSessionPreparationCommandV1 { readonly schemaVersion: 1; readonly kind: 'transition'; readonly operationId: string; readonly preparationId: string; readonly expectedRevision: number; readonly target: 'draft' | 'review' | 'ready' }
export interface CopySessionPreparationCommandV1 { readonly schemaVersion: 1; readonly kind: 'copy'; readonly operationId: string; readonly sourcePreparationId: string; readonly expectedSourceRevision: number; readonly title: string }
export interface ImportSessionPreparationScenesCommandV1 { readonly schemaVersion: 1; readonly kind: 'import-scenes'; readonly operationId: string; readonly preparationId: string; readonly expectedRevision: number; readonly sourcePreparationId: string; readonly expectedSourceRevision: number; readonly sceneIds: readonly string[] }
export interface TerminalSessionPreparationCommandV1 { readonly schemaVersion: 1; readonly kind: 'archive' | 'cancel'; readonly operationId: string; readonly preparationId: string; readonly expectedRevision: number }
export type SessionPreparationCommandV1 = CreateSessionPreparationCommandV1 | SaveSessionPreparationCommandV1 | TransitionSessionPreparationCommandV1 | CopySessionPreparationCommandV1 | ImportSessionPreparationScenesCommandV1 | TerminalSessionPreparationCommandV1
export interface SessionPreparationMutationProjectionV1 { readonly schemaVersion: 1; readonly operationId: string; readonly commandKind: SessionPreparationCommandV1['kind']; readonly exactRetry: boolean; readonly preparation: ReturnType<typeof parseSessionPreparationDocumentV1> }

export class SessionPreparationOperationContractError extends Error {
  constructor(readonly path: string, message: string) { super(`${path}: ${message}`); this.name = 'SessionPreparationOperationContractError' }
}
const fail = (path: string, message: string): never => { throw new SessionPreparationOperationContractError(path, message) }
const object = (value: unknown, path: string): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : fail(path, 'must be an object')
const exact = (row: Record<string, unknown>, keys: readonly string[], path: string): void => { const expected = new Set(keys); if (Object.keys(row).length !== expected.size || Object.keys(row).some(key => !expected.has(key))) fail(path, 'has unsupported or missing fields') }
const id = (value: unknown, path: string, pattern: RegExp): string => typeof value === 'string' && pattern.test(value) ? value : fail(path, 'must be a stable bounded ID')
const integer = (value: unknown, path: string): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fail(path, 'must be a non-negative safe integer')
const title = (value: unknown, path: string): string => typeof value === 'string' && value.length > 0 && value.length <= 160 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value) ? value : fail(path, 'must be non-empty bounded text')
const scheduled = (value: unknown, path: string): string | null => value === null ? null : typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : fail(path, 'must be null or a normalized ISO instant')
const OPERATION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const PREPARATION = /^session-preparation:v1:[a-z0-9]+(?:-[a-z0-9]+)*$/
const ENTRY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const parseContent = (value: unknown, path: string): SessionPreparationContentV1 => {
  const row = object(value, path); exact(row, ['title', 'scheduledFor', 'playerOverview', 'gmNotes', 'scenes', 'handouts', 'unresolvedDecisions'], path)
  const parsed = parseSessionPreparationDocumentV1({ schemaVersion: 1, preparationId: 'session-preparation:v1:content-validation', revision: 0, lifecycle: 'draft', title: row.title, scheduledFor: row.scheduledFor, playerOverview: row.playerOverview, gmNotes: row.gmNotes, scenes: row.scenes, handouts: row.handouts, unresolvedDecisions: row.unresolvedDecisions, launches: [], provenance: { kind: 'campaign-authored', sourcePreparationId: null, sourceRevision: null }, createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z' })
  return Object.freeze({ title: parsed.title, scheduledFor: parsed.scheduledFor, playerOverview: parsed.playerOverview, gmNotes: parsed.gmNotes, scenes: parsed.scenes, handouts: parsed.handouts, unresolvedDecisions: parsed.unresolvedDecisions })
}
export const parseSessionPreparationCommandV1 = (value: unknown): SessionPreparationCommandV1 => {
  const root = object(value, 'command')
  if (root.schemaVersion !== 1 || typeof root.kind !== 'string') fail('command', 'must be a supported schema-v1 command')
  const operationId = id(root.operationId, 'command.operationId', OPERATION)
  if (root.kind === 'create') { exact(root, ['schemaVersion', 'kind', 'operationId', 'title', 'scheduledFor'], 'command'); return Object.freeze({ schemaVersion: 1, kind: 'create', operationId, title: title(root.title, 'command.title'), scheduledFor: scheduled(root.scheduledFor, 'command.scheduledFor') }) }
  if (root.kind === 'copy') { exact(root, ['schemaVersion', 'kind', 'operationId', 'sourcePreparationId', 'expectedSourceRevision', 'title'], 'command'); return Object.freeze({ schemaVersion: 1, kind: 'copy', operationId, sourcePreparationId: id(root.sourcePreparationId, 'command.sourcePreparationId', PREPARATION), expectedSourceRevision: integer(root.expectedSourceRevision, 'command.expectedSourceRevision'), title: title(root.title, 'command.title') }) }
  const preparationId = id(root.preparationId, 'command.preparationId', PREPARATION)
  const expectedRevision = integer(root.expectedRevision, 'command.expectedRevision')
  if (root.kind === 'save') { exact(root, ['schemaVersion', 'kind', 'operationId', 'preparationId', 'expectedRevision', 'content'], 'command'); return Object.freeze({ schemaVersion: 1, kind: 'save', operationId, preparationId, expectedRevision, content: parseContent(root.content, 'command.content') }) }
  if (root.kind === 'transition') {
    exact(root, ['schemaVersion', 'kind', 'operationId', 'preparationId', 'expectedRevision', 'target'], 'command')
    if (root.target !== 'draft' && root.target !== 'review' && root.target !== 'ready') fail('command.target', 'must be draft, review, or ready')
    return Object.freeze({ schemaVersion: 1, kind: 'transition', operationId, preparationId, expectedRevision, target: root.target as 'draft' | 'review' | 'ready' })
  }
  if (root.kind === 'import-scenes') {
    exact(root, ['schemaVersion', 'kind', 'operationId', 'preparationId', 'expectedRevision', 'sourcePreparationId', 'expectedSourceRevision', 'sceneIds'], 'command')
    if (!Array.isArray(root.sceneIds) || root.sceneIds.length < 1 || root.sceneIds.length > 20) fail('command.sceneIds', 'must contain 1 through 20 scene IDs')
    const sceneIds = (root.sceneIds as unknown[]).map((entry: unknown, index: number) => id(entry, `command.sceneIds[${index}]`, ENTRY)); if (new Set(sceneIds).size !== sceneIds.length) fail('command.sceneIds', 'must be unique')
    return Object.freeze({ schemaVersion: 1, kind: 'import-scenes', operationId, preparationId, expectedRevision, sourcePreparationId: id(root.sourcePreparationId, 'command.sourcePreparationId', PREPARATION), expectedSourceRevision: integer(root.expectedSourceRevision, 'command.expectedSourceRevision'), sceneIds: Object.freeze(sceneIds) })
  }
  if (root.kind === 'archive' || root.kind === 'cancel') { exact(root, ['schemaVersion', 'kind', 'operationId', 'preparationId', 'expectedRevision'], 'command'); return Object.freeze({ schemaVersion: 1, kind: root.kind, operationId, preparationId, expectedRevision }) }
  return fail('command.kind', 'is not supported')
}
