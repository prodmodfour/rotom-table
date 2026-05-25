type RevisionBrand<TName extends string> = number & { readonly __revisionBrand: TName }

type RevisionScopeBrand<TScope extends string> = { readonly __revisionScope: TScope }

export type Revision = RevisionBrand<'Revision'>
export type SessionRevision = Revision & RevisionScopeBrand<'session'>
export type MapRevision = Revision & RevisionScopeBrand<'map'>
export type SerializedRevision = number
export type RevisionComparison = -1 | 0 | 1

export const INITIAL_REVISION_VALUE = 0
export const MAX_REVISION_VALUE = Number.MAX_SAFE_INTEGER
export const REVISION_PATTERN_DESCRIPTION = 'a safe non-negative integer revision'

export const INITIAL_SESSION_REVISION = INITIAL_REVISION_VALUE as SessionRevision
export const INITIAL_MAP_REVISION = INITIAL_REVISION_VALUE as MapRevision

const parseRevisionNumber = (value: unknown, label: string): number => {
  if (!isRevision(value)) {
    throw new Error(`${label} must be ${REVISION_PATTERN_DESCRIPTION}`)
  }
  return value
}

const incrementRevisionNumber = (value: unknown, label: string): number => {
  const revision = parseRevisionNumber(value, label)
  if (revision >= MAX_REVISION_VALUE) {
    throw new Error(`${label} cannot advance past ${MAX_REVISION_VALUE}`)
  }
  return revision + 1
}

const compareRevisionNumbers = (left: unknown, right: unknown): RevisionComparison => {
  const leftRevision = parseRevisionNumber(left, 'leftRevision')
  const rightRevision = parseRevisionNumber(right, 'rightRevision')

  if (leftRevision === rightRevision) return 0
  return leftRevision < rightRevision ? -1 : 1
}

export const isRevision = (value: unknown): value is Revision =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= INITIAL_REVISION_VALUE

export const isSessionRevision = (value: unknown): value is SessionRevision => isRevision(value)

export const isMapRevision = (value: unknown): value is MapRevision => isRevision(value)

export const parseRevision = (value: unknown, label = 'revision'): Revision =>
  parseRevisionNumber(value, label) as Revision

export const parseSessionRevision = (value: unknown, label = 'sessionRevision'): SessionRevision =>
  parseRevisionNumber(value, label) as SessionRevision

export const parseMapRevision = (value: unknown, label = 'mapRevision'): MapRevision =>
  parseRevisionNumber(value, label) as MapRevision

export const incrementRevision = (revision: Revision, label = 'revision'): Revision =>
  incrementRevisionNumber(revision, label) as Revision

export const incrementSessionRevision = (
  revision: SessionRevision,
  label = 'sessionRevision',
): SessionRevision => incrementRevisionNumber(revision, label) as SessionRevision

export const incrementMapRevision = (revision: MapRevision, label = 'mapRevision'): MapRevision =>
  incrementRevisionNumber(revision, label) as MapRevision

export const nextRevision = incrementRevision
export const nextSessionRevision = incrementSessionRevision
export const nextMapRevision = incrementMapRevision

export const compareRevisions = (left: Revision, right: Revision): RevisionComparison =>
  compareRevisionNumbers(left, right)

export const compareSessionRevisions = (
  left: SessionRevision,
  right: SessionRevision,
): RevisionComparison => compareRevisionNumbers(left, right)

export const compareMapRevisions = (left: MapRevision, right: MapRevision): RevisionComparison =>
  compareRevisionNumbers(left, right)

export const isRevisionBefore = (left: Revision, right: Revision): boolean =>
  compareRevisions(left, right) === -1

export const isRevisionAfter = (left: Revision, right: Revision): boolean =>
  compareRevisions(left, right) === 1

export const isSameRevision = (left: Revision, right: Revision): boolean =>
  compareRevisions(left, right) === 0

export const serializeRevision = (revision: Revision, label = 'revision'): SerializedRevision =>
  parseRevisionNumber(revision, label)

export const serializeSessionRevision = (
  revision: SessionRevision,
  label = 'sessionRevision',
): SerializedRevision => parseRevisionNumber(revision, label)

export const serializeMapRevision = (
  revision: MapRevision,
  label = 'mapRevision',
): SerializedRevision => parseRevisionNumber(revision, label)
