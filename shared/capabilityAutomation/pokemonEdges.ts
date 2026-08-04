import { resolvedSheetEdgeInstances } from '../edgeAutomation/sheetEdges'
import { edgeChoiceValues } from '../edgeAutomation/instances'

export interface PokemonCapabilityEdgeSource {
  readonly slug?: string
  readonly edges?: readonly { readonly name: string; readonly automation?: unknown }[]
}

const normalized = (value: string): string => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')

/** Exact fixed-name Capability Poké Edge lookup; free-form prose is never interpreted. */
export const hasPokemonCapabilityEdge = (
  source: PokemonCapabilityEdgeSource,
  edgeName: string,
): boolean => source.slug
  ? resolvedSheetEdgeInstances({ slug: source.slug, edges: source.edges }, 'poke')
      .some(instance => normalized(instance.canonicalId) === normalized(edgeName))
  : (source.edges ?? []).some(edge => normalized(edge.name) === normalized(edgeName))

/**
 * Read every reviewed selection from `Edge (Capability)` or
 * `Edge: Capability`. Character sheets predate typed Poké Edge choices, so
 * only these bounded compatibility spellings are authoritative.
 */
export const selectedPokemonCapabilityEdges = (
  source: PokemonCapabilityEdgeSource,
  edgeName: string,
): readonly string[] => {
  if (source.slug) {
    const instances = resolvedSheetEdgeInstances({ slug: source.slug, edges: source.edges }, 'poke')
      .filter(instance => normalized(instance.canonicalId) === normalized(edgeName))
    const selections = instances.flatMap(instance => instance.choices.flatMap(choice => edgeChoiceValues(instance, choice.choiceId)))
    return Object.freeze([...new Map(selections.map(value => [normalized(value), value])).values()])
  }
  const escaped = edgeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^${escaped}\\s*(?:\\(([^)]+)\\)|[:—-]\\s*([^:;]{1,80}))$`, 'i')
  const selections = (source.edges ?? []).flatMap((edge) => {
    const match = pattern.exec(edge.name.trim())
    const selected = (match?.[1] ?? match?.[2])?.trim()
    return selected ? [selected] : []
  })
  return Object.freeze([...new Map(selections.map(value => [normalized(value), value])).values()])
}

export const selectedPokemonCapabilityEdge = (
  source: PokemonCapabilityEdgeSource,
  edgeName: string,
): string | null => selectedPokemonCapabilityEdges(source, edgeName)[0] ?? null
