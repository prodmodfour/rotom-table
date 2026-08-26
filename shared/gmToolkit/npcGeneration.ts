import type { WildGenerationCandidateProjectionV1, WildGenerationJournalDrawV1 } from './generation'

export const NPC_GENERATION_SCHEMA_VERSION = 1 as const
export interface NpcGuidedDecisionsV1 {
  readonly name: string
  readonly identity: string
  readonly tactics: string
  readonly notes: string
}
export interface NpcGenerationPreviewCommandV1 {
  readonly schemaVersion: 1
  readonly mode: 'preview'
  readonly operationId: string
  readonly archetypeId: string
  readonly expectedArchetypeRevision: number
  readonly rosterCount: number
  readonly guided: NpcGuidedDecisionsV1
}
export interface NpcGenerationCommitCommandV1 {
  readonly schemaVersion: 1
  readonly mode: 'commit'
  readonly operationId: string
  readonly previewToken: string
  readonly trainerFolder: string
  readonly pokemonFolder: string
}
export type NpcGenerationCommandV1 = NpcGenerationPreviewCommandV1 | NpcGenerationCommitCommandV1
export interface NpcTrainerCandidateProjectionV1 {
  readonly candidateId: string
  readonly name: string
  readonly level: number
  readonly statTotals: Readonly<Record<'hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd', number>>
  readonly skillRanks: Readonly<Record<string, string>>
  readonly trainingFeatureId: string
  readonly featureNames: readonly string[]
  readonly edgeNames: readonly string[]
  readonly money: number
  readonly inventory: readonly { readonly section: string; readonly itemId: string; readonly quantity: number }[]
  readonly guided: NpcGuidedDecisionsV1
}
export interface NpcGenerationPreviewProjectionV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly archetype: { readonly name: string; readonly revision: number }
  readonly trainer: NpcTrainerCandidateProjectionV1
  readonly roster: readonly WildGenerationCandidateProjectionV1[]
  readonly previewToken: string
  readonly expiresAt: string
  readonly journal: readonly WildGenerationJournalDrawV1[]
  readonly sourceDefinitionHashes: readonly string[]
  readonly previewHash: string
}
export interface NpcGenerationCommitProjectionV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly exactRetry: boolean
  readonly committedAt: string
  readonly packageId: string
  readonly archetype: { readonly name: string; readonly revision: number }
  readonly trainer: { readonly kind: 'trainer'; readonly slug: string; readonly revision: 0; readonly candidateId: string; readonly custody: 'gm-campaign' }
  readonly roster: readonly { readonly kind: 'pokemon'; readonly slug: string; readonly revision: 0; readonly candidateId: string; readonly custody: 'npc-roster'; readonly ownerTrainerSlug: string }[]
  readonly trainerCandidate: NpcTrainerCandidateProjectionV1
  readonly pokemonCandidates: readonly WildGenerationCandidateProjectionV1[]
}

export class NpcGenerationContractError extends Error {
  readonly path: string
  constructor(path: string, message: string) { super(`${path}: ${message}`); this.name = 'NpcGenerationContractError'; this.path = path }
}
const fail = (path: string, message: string): never => { throw new NpcGenerationContractError(path, message) }
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
const id = (value: unknown, path: string, pattern: RegExp): string => {
  if (typeof value !== 'string' || !pattern.test(value)) return fail(path, 'must be a stable bounded ID')
  return value
}
const guidedText = (value: unknown, path: string, max: number, required = false): string => {
  if (typeof value !== 'string' || value.length > max || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value) || (required && !value)) return fail(path, `must be ${required ? 'non-empty ' : ''}bounded text`)
  return value
}
const folder = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length > 200 || value.startsWith('/') || value.includes('..') || /\\/.test(value)) return fail(path, 'must be a bounded relative campaign folder')
  return value
}
const OPERATION = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const ARCHETYPE = /^npc-archetype:v1:[a-z0-9]+(?:-[a-z0-9]+)*$/

export const parseNpcGenerationPreviewCommandV1 = (value: unknown): NpcGenerationPreviewCommandV1 => {
  const root = object(value, 'command')
  exact(root, ['schemaVersion', 'mode', 'operationId', 'archetypeId', 'expectedArchetypeRevision', 'rosterCount', 'guided'], 'command')
  if (root.schemaVersion !== 1 || root.mode !== 'preview') fail('command', 'must be a schema-v1 NPC preview command')
  const guided = object(root.guided, 'command.guided'); exact(guided, ['name', 'identity', 'tactics', 'notes'], 'command.guided')
  return {
    schemaVersion: 1, mode: 'preview', operationId: id(root.operationId, 'command.operationId', OPERATION),
    archetypeId: id(root.archetypeId, 'command.archetypeId', ARCHETYPE), expectedArchetypeRevision: integer(root.expectedArchetypeRevision, 'command.expectedArchetypeRevision', 0, Number.MAX_SAFE_INTEGER),
    rosterCount: integer(root.rosterCount, 'command.rosterCount', 0, 6),
    guided: {
      name: guidedText(guided.name, 'command.guided.name', 120, true), identity: guidedText(guided.identity, 'command.guided.identity', 2000),
      tactics: guidedText(guided.tactics, 'command.guided.tactics', 2000), notes: guidedText(guided.notes, 'command.guided.notes', 4000),
    },
  }
}
export const parseNpcGenerationCommitCommandV1 = (value: unknown): NpcGenerationCommitCommandV1 => {
  const root = object(value, 'command')
  exact(root, ['schemaVersion', 'mode', 'operationId', 'previewToken', 'trainerFolder', 'pokemonFolder'], 'command')
  if (root.schemaVersion !== 1 || root.mode !== 'commit') fail('command', 'must be a schema-v1 NPC commit command')
  if (typeof root.previewToken !== 'string' || root.previewToken.length < 32 || root.previewToken.length > 32_768) fail('command.previewToken', 'must be an opaque bounded server token')
  return { schemaVersion: 1, mode: 'commit', operationId: id(root.operationId, 'command.operationId', OPERATION), previewToken: root.previewToken as string, trainerFolder: folder(root.trainerFolder, 'command.trainerFolder'), pokemonFolder: folder(root.pokemonFolder, 'command.pokemonFolder') }
}
export const parseNpcGenerationCommandV1 = (value: unknown): NpcGenerationCommandV1 => object(value, 'command').mode === 'preview'
  ? parseNpcGenerationPreviewCommandV1(value)
  : parseNpcGenerationCommitCommandV1(value)
