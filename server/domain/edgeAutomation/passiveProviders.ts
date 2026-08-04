import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { EdgeFamily } from '#shared/edgeAutomation/catalog'
import type { EdgeMechanicDeclaration } from '#shared/edgeAutomation/spec'
import { edgeChoiceValues } from '#shared/edgeAutomation/instances'
import { resolveEffectiveEdges } from './effectiveEdges'

export interface EdgeProviderContribution {
  readonly contributionId: string
  readonly family: EdgeFamily
  readonly canonicalId: string
  readonly edgeInstanceId: string
  readonly definitionHash: string
  readonly mechanicId: string
  readonly propertyId: string
  readonly operation: EdgeMechanicDeclaration['operation']
  readonly value: number | string | boolean | null
  readonly applied: boolean
  readonly reason: string | null
  readonly order: number
}

export interface EdgeProviderQuery {
  readonly sheet: CharacterSheet | TrainerSheet
  readonly family: EdgeFamily
  readonly propertyId: string
  readonly contextIds?: ReadonlySet<string>
  readonly selectedValue?: string | null
  readonly baseValue?: number | string | boolean | null
  readonly resolveValueSource?: (source: string, canonicalId: string) => number | string | boolean | null
}

export interface EdgeProviderResult {
  readonly propertyId: string
  readonly baseValue: number | string | boolean | null
  readonly value: number | string | boolean | null
  readonly contributions: readonly EdgeProviderContribution[]
}

const normalized = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')

const contextMatches = (contextId: string, contexts: ReadonlySet<string>): boolean => (
  contextId === 'always' || contexts.has(contextId)
)

const mechanicChoiceMatches = (
  mechanic: EdgeMechanicDeclaration,
  choices: readonly { readonly choiceId: string; readonly values: readonly string[] }[],
  selectedValue: string | null | undefined,
): boolean => {
  if (!mechanic.choiceId) return true
  const values = choices.find(choice => choice.choiceId === mechanic.choiceId)?.values ?? []
  if (values.length === 0) return false
  if (!selectedValue) return true
  return values.some(value => normalized(value) === normalized(selectedValue))
}

const apply = (
  current: number | string | boolean | null,
  operation: EdgeMechanicDeclaration['operation'],
  value: number | string | boolean | null,
): number | string | boolean | null => {
  if (operation === 'add') return typeof current === 'number' && typeof value === 'number'
    ? current + value : typeof value === 'number' && current === null ? value : current
  if (operation === 'multiply') return typeof current === 'number' && typeof value === 'number' ? current * value : current
  if (operation === 'set' || operation === 'substitute') return value
  if (operation === 'prevent') return true
  if (operation === 'permit' || operation === 'grant' || operation === 'subscribe') return value ?? true
  return current
}

/** Ordered, source-labelled Edge contributions for any authoritative query. */
export const resolveEdgeProvider = (query: EdgeProviderQuery): EdgeProviderResult => {
  const set = resolveEffectiveEdges({ ownerId: query.sheet.slug, family: query.family, sheet: query.sheet })
  const contexts = query.contextIds ?? new Set<string>()
  let value = query.baseValue ?? null
  const contributions: EdgeProviderContribution[] = []
  let order = 0
  for (const instance of set.instances) {
    for (const mechanic of instance.mechanics) {
      if (mechanic.propertyId !== query.propertyId) continue
      const context = contextMatches(mechanic.contextId, contexts)
      const choice = mechanicChoiceMatches(mechanic, instance.instance.choices, query.selectedValue)
      const sourcedValue = mechanic.valueSource
        ? query.resolveValueSource?.(mechanic.valueSource, instance.canonicalId) ?? null
        : mechanic.value
      const applied = instance.effective && context && choice && (mechanic.valueSource === null || sourcedValue !== null)
      if (applied) value = apply(value, mechanic.operation, sourcedValue)
      contributions.push(Object.freeze({
        contributionId: `edge-contribution:${instance.instanceId}:${mechanic.mechanicId}:${order}`,
        family: instance.family,
        canonicalId: instance.canonicalId,
        edgeInstanceId: instance.instanceId,
        definitionHash: instance.definitionHash,
        mechanicId: mechanic.mechanicId,
        propertyId: mechanic.propertyId,
        operation: mechanic.operation,
        value: sourcedValue,
        applied,
        reason: !instance.effective ? instance.suppressionReasonCode
          : !context ? 'edge.context.not-satisfied'
            : !choice ? 'edge.choice.not-selected'
              : mechanic.valueSource && sourcedValue === null ? 'edge.value-source.unavailable' : null,
        order: order++,
      }))
    }
  }
  return Object.freeze({
    propertyId: query.propertyId,
    baseValue: query.baseValue ?? null,
    value,
    contributions: Object.freeze(contributions),
  })
}

export const edgeNumericBonus = (query: Omit<EdgeProviderQuery, 'baseValue'>): number => {
  const result = resolveEdgeProvider({ ...query, baseValue: 0 })
  return typeof result.value === 'number' ? result.value : 0
}

export const edgeGrants = (input: {
  readonly sheet: CharacterSheet | TrainerSheet
  readonly family: EdgeFamily
  readonly propertyId: string
}): readonly { readonly canonicalId: string; readonly edgeInstanceId: string; readonly value: string; readonly definitionHash: string }[] => {
  const set = resolveEffectiveEdges({ ownerId: input.sheet.slug, family: input.family, sheet: input.sheet })
  return Object.freeze(set.instances.flatMap(instance => instance.effective
    ? instance.mechanics.flatMap(mechanic => {
        if (mechanic.kind !== 'permanent-grant' || mechanic.propertyId !== input.propertyId) return []
        const values = mechanic.value === 'choice' && mechanic.choiceId
          ? edgeChoiceValues(instance.instance, mechanic.choiceId)
          : typeof mechanic.value === 'string' ? [mechanic.value] : []
        return values.map(value => Object.freeze({ canonicalId: instance.canonicalId, edgeInstanceId: instance.instanceId, value, definitionHash: instance.definitionHash }))
      }) : []))
}
