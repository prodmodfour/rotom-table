/**
 * Project a canonical Move row to the mechanics-only shape frozen by systems
 * that predate Pokémon Contests.
 *
 * `contest` is reviewed additive metadata. It is authoritative for Contest
 * play, but must not invalidate immutable Breeding or machine-learning
 * fingerprints whose reviewed scope is the pre-Contest Move record.
 */
export const projectLegacyMoveMechanicalAuthority = (
  record: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => {
  const { contest: _contestIdentity, ...mechanicalAuthority } = record
  return Object.freeze(mechanicalAuthority)
}

/** P8-001's one reviewed typography-only Move-record successor. */
export const REVIEWED_FACADE_MECHANICAL_SUCCESSOR = Object.freeze({
  canonicalId: 'facade',
  beforeSourceName: 'Façade',
  beforeRecordSha256: '070bf4d4d21c98dbb0213cc84a88f24e6d5302600e455ff1155e1e2818c62b85',
  afterSourceName: 'Facade',
  afterRecordSha256: 'b26f4a5f2e31b96ed7e725ebfca8f6787aae83d41d55687cc0bb3b31063b22d1',
  migrationId: 'move-data-facade-identity-normalization-v1',
})

export const currentMoveSourceNameForLegacyIdentity = (
  canonicalId: string,
  frozenSourceName: string,
): string => canonicalId === REVIEWED_FACADE_MECHANICAL_SUCCESSOR.canonicalId
  && frozenSourceName === REVIEWED_FACADE_MECHANICAL_SUCCESSOR.beforeSourceName
  ? REVIEWED_FACADE_MECHANICAL_SUCCESSOR.afterSourceName
  : frozenSourceName

/**
 * Match either the exact frozen mechanical row or the one reviewed Facade
 * successor. Callers must hash `projectLegacyMoveMechanicalAuthority(record)`.
 */
export const isReviewedLegacyMoveMechanicalFingerprint = (input: {
  readonly canonicalId: string
  readonly frozenSourceName: string
  readonly frozenRecordSha256: string
  readonly currentSourceName: string
  readonly currentRecordSha256: string
}): boolean => input.currentSourceName === input.frozenSourceName
  && input.currentRecordSha256 === input.frozenRecordSha256
  || input.canonicalId === REVIEWED_FACADE_MECHANICAL_SUCCESSOR.canonicalId
  && input.frozenSourceName === REVIEWED_FACADE_MECHANICAL_SUCCESSOR.beforeSourceName
  && input.frozenRecordSha256 === REVIEWED_FACADE_MECHANICAL_SUCCESSOR.beforeRecordSha256
  && input.currentSourceName === REVIEWED_FACADE_MECHANICAL_SUCCESSOR.afterSourceName
  && input.currentRecordSha256 === REVIEWED_FACADE_MECHANICAL_SUCCESSOR.afterRecordSha256
