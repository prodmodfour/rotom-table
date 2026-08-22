import type { ContestStatId, ContestVariantId } from './ids'

export interface ContestRibbonRecordV1 {
  readonly schemaVersion: 1
  readonly ribbonId: string
  readonly contestId: string
  readonly hallName: string
  readonly contestName: string
  readonly contestTypeId: ContestStatId | null
  readonly variantId: ContestVariantId
  readonly placement: 1
  readonly awardedAt: number
  readonly trainerSheetSlug: string
  readonly pokemonSheetSlug: string
}

export interface TrainerContestResultRecordV1 {
  readonly schemaVersion: 1
  readonly resultId: string
  readonly contestId: string
  readonly hallName: string
  readonly contestName: string
  readonly contestTypeId: ContestStatId | null
  readonly variantId: ContestVariantId
  readonly placement: number
  readonly score: number
  readonly pokemonSheetSlugs: readonly string[]
  /** Explicit settlement authority; absent only on an early schema-v1 result. */
  readonly ribbonAwarded?: boolean
  /** Exact awarded Ribbon identities; absent only on an early schema-v1 result. */
  readonly ribbonIds?: readonly string[]
  readonly completedAt: number
}

export const contestRibbonQualificationCount = (ribbons: readonly ContestRibbonRecordV1[] | null | undefined): number => new Set((ribbons ?? []).map(row => row.ribbonId)).size
