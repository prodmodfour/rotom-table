import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import successors from '../../data/deferred-closure/successor-chain.v1.json'

export const repositoryFileSha256 = (path: string): string => createHash('sha256')
  .update(readFileSync(path))
  .digest('hex')

/**
 * Resolve a frozen recorded hash to the current file only through one
 * contiguous, accepted successor edge at each step.
 */
export const acceptedSuccessorHead = (path: string, recordedSha256: string): string => {
  const current = repositoryFileSha256(path)
  const edges = successors.edges.filter(edge => edge.surface === path && edge.reviewStatus === 'accepted')
  const visited = new Set<string>()
  let cursor = recordedSha256
  while (cursor !== current) {
    if (visited.has(cursor)) throw new Error(`${path} accepted successor chain cycles at ${cursor}.`)
    visited.add(cursor)
    const candidates = edges.filter(edge => edge.beforeSha256 === cursor)
    if (candidates.length !== 1) {
      throw new Error(`${path} requires one accepted successor from ${cursor}; found ${candidates.length}.`)
    }
    cursor = candidates[0]!.afterSha256
  }
  return cursor
}
