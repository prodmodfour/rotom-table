import { nextRevision } from '#shared/sessionRevisions'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { AuthoritativeMoveGroupInventoryRead } from './itemResources'
import type {
  MoveGroupInventoryStateChange,
  MoveStateChangePlan,
} from './plan'

export type MoveGroupInventoryPersistenceChange = Pick<
  MoveGroupInventoryStateChange,
  'expectedRevision' | 'previous' | 'current' | 'scope'
>

export class MoveGroupInventoryPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoveGroupInventoryPlanError'
  }
}

const fail = (message: string): never => {
  throw new MoveGroupInventoryPlanError(message)
}

const readRevisionsBySlug = (
  reads: readonly AuthoritativeMoveGroupInventoryRead[],
): ReadonlyMap<string, number> => {
  const revisions = new Map<string, number>()
  for (const read of reads) {
    const existing = revisions.get(read.slug)
    if (existing !== undefined && existing !== read.revision) {
      fail(
        `Group inventory ${read.slug} has conflicting planned read revisions ${existing} and ${read.revision}.`,
      )
    }
    revisions.set(read.slug, read.revision)
  }
  return revisions
}

const assertDocumentIdentity = (
  document: GroupInventoryDocument,
  slug: string,
  revision: number,
  label: string,
): void => {
  if (document.slug !== slug || document.revision !== revision) {
    fail(`${label} must identify group inventory ${slug} at revision ${revision}.`)
  }
}

/**
 * Resolve the external group-inventory writes from a trusted typed move plan.
 * Every write must be covered by the authoritative read set used to plan it.
 */
export const moveGroupInventoryChangesForPersistence = (input: {
  readonly plan: MoveStateChangePlan
  readonly reads: readonly AuthoritativeMoveGroupInventoryRead[]
}): readonly MoveGroupInventoryPersistenceChange[] => {
  const readRevisions = readRevisionsBySlug(input.reads)
  const changes = input.plan.changes.filter(
    (change): change is MoveGroupInventoryStateChange => (
      change.kind === 'group-inventory-state'
    ),
  )
  const seen = new Set<string>()

  for (const change of changes) {
    const slug = change.scope.resourceId
    if (seen.has(slug)) {
      fail(`Group inventory ${slug} has more than one write in the move plan.`)
    }
    seen.add(slug)
    if (readRevisions.get(slug) !== change.expectedRevision) {
      fail(
        `Group inventory ${slug} write revision ${change.expectedRevision} is not covered by the authoritative read set.`,
      )
    }
    assertDocumentIdentity(
      change.previous,
      slug,
      change.expectedRevision,
      `Previous group inventory value for ${slug}`,
    )
    assertDocumentIdentity(
      change.current,
      slug,
      nextRevision(change.expectedRevision),
      `Current group inventory value for ${slug}`,
    )
  }

  return Object.freeze(changes.map(change => Object.freeze({
    expectedRevision: change.expectedRevision,
    scope: change.scope,
    previous: change.previous,
    current: change.current,
  })))
}
