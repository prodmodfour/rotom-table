import { ENCOUNTER_RECIPE_IDS, type EncounterRecipeId } from './model'

export const ENCOUNTER_BUILDER_SCHEMA_VERSION = 2 as const
export const ENCOUNTER_BUILDER_MAX_CAST = 30 as const

export type EncounterBuilderHandoffKind = 'wild-package' | 'npc-package' | 'session-preparation'
export type EncounterBuilderSheetKind = 'pokemon' | 'trainer'

export interface EncounterBuilderHandoffV2 {
  readonly kind: EncounterBuilderHandoffKind
  readonly documentId: string
  readonly expectedRevision: number
  readonly sceneId: string | null
}

export interface EncounterBuilderCastMember {
  readonly castId: string
  readonly sheet: {
    readonly kind: EncounterBuilderSheetKind
    readonly slug: string
    readonly expectedRevision: number
  }
  readonly sourceCandidateId: string | null
  readonly sideId: string | null
  readonly role: 'boss' | 'leader' | 'standard' | 'minion' | 'support'
  readonly hidden: boolean
}

/**
 * GM-only, server-resolved Builder input. The launch command carries only the
 * immutable `handoff` reference; labels and scene prose are conveniences and
 * are resolved again inside the launch transaction.
 */
export interface EncounterBuilderHandoffProjectionV1 {
  readonly schemaVersion: 1
  readonly handoff: EncounterBuilderHandoffV2
  readonly source: {
    readonly label: string
    readonly sceneLabel: string | null
  }
  readonly defaults: {
    readonly name: string
    readonly recipe: EncounterRecipeId
    readonly map: { readonly slug: string; readonly expectedRevision: number } | null
    readonly publicStakes: string | null
    readonly gmStakes: string | null
    readonly notes: string | null
    readonly storyLocked: boolean
  }
  readonly cast: readonly {
    readonly sheet: {
      readonly kind: EncounterBuilderSheetKind
      readonly slug: string
      readonly expectedRevision: number
    }
    readonly sourceCandidateId: string | null
    readonly displayName: string
    readonly displayLevel: number | null
    readonly placementIntent: {
      readonly kind: 'builder-default' | 'map-zone'
      readonly zoneLabel: string | null
    }
  }[]
}

export interface LaunchEncounterBuilderRequest {
  readonly schemaVersion: typeof ENCOUNTER_BUILDER_SCHEMA_VERSION
  readonly launchId: string
  readonly encounterId: string
  readonly name: string
  readonly recipe: EncounterRecipeId
  readonly mapSlug: string
  readonly expectedMapRevision: number
  readonly clientId: string | null
  readonly startInitiative: boolean
  readonly presentation: {
    readonly stage: 'standard' | 'boss' | 'chase'
    readonly tactical: 'on-demand' | 'split'
  }
  readonly handoff: EncounterBuilderHandoffV2
  readonly cast: readonly EncounterBuilderCastMember[]
  readonly publicStakes: string | null
  readonly gmStakes: string | null
  readonly notes: string | null
}

export interface LaunchEncounterBuilderResult {
  readonly ok: true
  readonly exactRetry: boolean
  readonly launchId: string
  readonly encounterId: string
  readonly encounterRevision: number
  readonly mapSlug: string
  readonly mapRevision: number
  readonly spawned: number
}

export class EncounterBuilderValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'EncounterBuilderValidationError'
  }
}
const fail = (path: string, message: string): never => { throw new EncounterBuilderValidationError(path, message) }
const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path, 'must be an object')
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, keys: readonly string[], path: string): void => {
  const expected = new Set(keys)
  if (Object.keys(value).length !== expected.size || Object.keys(value).some(key => !expected.has(key))) fail(path, 'has unsupported or missing fields')
}
const id = (value: unknown, path: string, maximum = 200): string => {
  if (typeof value !== 'string' || value.length > maximum || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value)) return fail(path, 'must be a stable ID')
  return value
}
const slug = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return fail(path, 'must be a campaign slug')
  return value
}
const text = (value: unknown, path: string, maximum: number, nullable = false): string | null => {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return fail(path, `must be bounded text of at most ${maximum} characters`)
  return value.trim()
}
const integer = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) return fail(path, `must be an integer from ${minimum} to ${maximum}`)
  return Number(value)
}

export const parseLaunchEncounterBuilderResult = (value: unknown): LaunchEncounterBuilderResult => {
  const root = record(value, 'builderResult')
  exact(root, ['ok', 'exactRetry', 'launchId', 'encounterId', 'encounterRevision', 'mapSlug', 'mapRevision', 'spawned'], 'builderResult')
  if (root.ok !== true || typeof root.exactRetry !== 'boolean') fail('builderResult', 'must be an accepted result')
  return Object.freeze({
    ok: true,
    exactRetry: root.exactRetry as boolean,
    launchId: id(root.launchId, 'builderResult.launchId'),
    encounterId: id(root.encounterId, 'builderResult.encounterId'),
    encounterRevision: integer(root.encounterRevision, 'builderResult.encounterRevision', 0, Number.MAX_SAFE_INTEGER),
    mapSlug: slug(root.mapSlug, 'builderResult.mapSlug'),
    mapRevision: integer(root.mapRevision, 'builderResult.mapRevision', 0, Number.MAX_SAFE_INTEGER),
    spawned: integer(root.spawned, 'builderResult.spawned', 0, ENCOUNTER_BUILDER_MAX_CAST),
  })
}

export const parseLaunchEncounterBuilderRequest = (value: unknown): LaunchEncounterBuilderRequest => {
  const root = record(value, 'builder')
  exact(root, ['schemaVersion', 'launchId', 'encounterId', 'name', 'recipe', 'mapSlug', 'expectedMapRevision', 'clientId', 'startInitiative', 'presentation', 'handoff', 'cast', 'publicStakes', 'gmStakes', 'notes'], 'builder')
  if (root.schemaVersion !== ENCOUNTER_BUILDER_SCHEMA_VERSION) fail('builder.schemaVersion', 'is unsupported')
  if (typeof root.recipe !== 'string' || !ENCOUNTER_RECIPE_IDS.includes(root.recipe as EncounterRecipeId)) fail('builder.recipe', 'is unknown')
  if (typeof root.startInitiative !== 'boolean') fail('builder.startInitiative', 'must be a boolean')

  const presentation = record(root.presentation, 'builder.presentation')
  exact(presentation, ['stage', 'tactical'], 'builder.presentation')
  if (!['standard', 'boss', 'chase'].includes(String(presentation.stage))) fail('builder.presentation.stage', 'is unknown')
  if (!['on-demand', 'split'].includes(String(presentation.tactical))) fail('builder.presentation.tactical', 'is unknown')

  const handoff = record(root.handoff, 'builder.handoff')
  exact(handoff, ['kind', 'documentId', 'expectedRevision', 'sceneId'], 'builder.handoff')
  if (!['wild-package', 'npc-package', 'session-preparation'].includes(String(handoff.kind))) fail('builder.handoff.kind', 'is unknown')
  const sceneId = handoff.sceneId === null ? null : id(handoff.sceneId, 'builder.handoff.sceneId')
  if (handoff.kind === 'session-preparation' && sceneId === null) fail('builder.handoff.sceneId', 'is required for session preparation')
  if (handoff.kind !== 'session-preparation' && sceneId !== null) fail('builder.handoff.sceneId', 'must be null for generated packages')

  if (!Array.isArray(root.cast) || root.cast.length < 1 || root.cast.length > ENCOUNTER_BUILDER_MAX_CAST) {
    fail('builder.cast', `must contain 1 to ${ENCOUNTER_BUILDER_MAX_CAST} members`)
  }
  const castInput = root.cast as unknown[]
  const cast = castInput.map((entry: unknown, index: number): EncounterBuilderCastMember => {
    const row = record(entry, `builder.cast[${index}]`)
    exact(row, ['castId', 'sheet', 'sourceCandidateId', 'sideId', 'role', 'hidden'], `builder.cast[${index}]`)
    const sheet = record(row.sheet, `builder.cast[${index}].sheet`)
    exact(sheet, ['kind', 'slug', 'expectedRevision'], `builder.cast[${index}].sheet`)
    if (sheet.kind !== 'pokemon' && sheet.kind !== 'trainer') fail(`builder.cast[${index}].sheet.kind`, 'is unknown')
    if (!['boss', 'leader', 'standard', 'minion', 'support'].includes(String(row.role))) fail(`builder.cast[${index}].role`, 'is unknown')
    if (typeof row.hidden !== 'boolean') fail(`builder.cast[${index}].hidden`, 'must be a boolean')
    return Object.freeze({
      castId: id(row.castId, `builder.cast[${index}].castId`),
      sheet: Object.freeze({
        kind: sheet.kind as EncounterBuilderSheetKind,
        slug: slug(sheet.slug, `builder.cast[${index}].sheet.slug`),
        expectedRevision: integer(sheet.expectedRevision, `builder.cast[${index}].sheet.expectedRevision`, 0, Number.MAX_SAFE_INTEGER),
      }),
      sourceCandidateId: row.sourceCandidateId === null ? null : id(row.sourceCandidateId, `builder.cast[${index}].sourceCandidateId`),
      sideId: row.sideId === null ? null : id(row.sideId, `builder.cast[${index}].sideId`),
      role: row.role as EncounterBuilderCastMember['role'],
      hidden: row.hidden as boolean,
    })
  })
  if (new Set(cast.map(member => member.castId)).size !== cast.length) fail('builder.cast', 'contains duplicate cast IDs')
  if (new Set(cast.map(member => `${member.sheet.kind}:${member.sheet.slug}`)).size !== cast.length) fail('builder.cast', 'contains duplicate sheet references')

  return Object.freeze({
    schemaVersion: ENCOUNTER_BUILDER_SCHEMA_VERSION,
    launchId: id(root.launchId, 'builder.launchId'),
    encounterId: id(root.encounterId, 'builder.encounterId'),
    name: text(root.name, 'builder.name', 200)!,
    recipe: root.recipe as EncounterRecipeId,
    mapSlug: slug(root.mapSlug, 'builder.mapSlug'),
    expectedMapRevision: integer(root.expectedMapRevision, 'builder.expectedMapRevision', 0, Number.MAX_SAFE_INTEGER),
    clientId: root.clientId === null ? null : id(root.clientId, 'builder.clientId'),
    startInitiative: root.startInitiative as boolean,
    presentation: Object.freeze({
      stage: presentation.stage as LaunchEncounterBuilderRequest['presentation']['stage'],
      tactical: presentation.tactical as LaunchEncounterBuilderRequest['presentation']['tactical'],
    }),
    handoff: Object.freeze({
      kind: handoff.kind as EncounterBuilderHandoffKind,
      documentId: id(handoff.documentId, 'builder.handoff.documentId'),
      expectedRevision: integer(handoff.expectedRevision, 'builder.handoff.expectedRevision', 0, Number.MAX_SAFE_INTEGER),
      sceneId,
    }),
    cast: Object.freeze(cast),
    publicStakes: text(root.publicStakes, 'builder.publicStakes', 4_000, true),
    gmStakes: text(root.gmStakes, 'builder.gmStakes', 4_000, true),
    notes: text(root.notes, 'builder.notes', 20_000, true),
  })
}
