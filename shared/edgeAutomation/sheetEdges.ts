import type { EdgeFamily } from './catalog'
import { edgeChoiceValues, resolveEdgeInstance, type EdgeInstanceData, type LegacyEdgeEntrySource } from './instances'

export interface EdgeSheetSource {
  readonly slug: string
  readonly edges?: readonly LegacyEdgeEntrySource[]
}

/**
 * Sheet-owned effective baseline used by shared derivation code. Encounter
 * grants/suppressions are layered by the server projection, never by clients.
 */
export const resolvedSheetEdgeInstances = (
  sheet: EdgeSheetSource,
  family: EdgeFamily,
): readonly EdgeInstanceData[] => Object.freeze((sheet.edges ?? []).slice(0, 128).flatMap((entry, index) => {
  const resolved = resolveEdgeInstance({ family, entry, ownerId: sheet.slug, index })
  return resolved.status === 'ready' && resolved.data ? [resolved.data] : []
}))

export const sheetHasCanonicalEdge = (
  sheet: EdgeSheetSource,
  family: EdgeFamily,
  canonicalId: string,
): boolean => resolvedSheetEdgeInstances(sheet, family).some(instance => instance.canonicalId === canonicalId)

export const sheetEdgeChoiceValues = (input: {
  readonly sheet: EdgeSheetSource
  readonly family: EdgeFamily
  readonly canonicalId: string
  readonly choiceId: string
}): readonly string[] => Object.freeze([
  ...new Set(resolvedSheetEdgeInstances(input.sheet, input.family)
    .filter(instance => instance.canonicalId === input.canonicalId)
    .flatMap(instance => edgeChoiceValues(instance, input.choiceId))),
])
