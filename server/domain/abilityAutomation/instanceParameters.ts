import canonicalAbilitiesJson from '../../../data/reference/abilities.json'
import parameterDefinitionsJson from '../../../data/ability-automation/parameter-definitions.json'
import {
  abilityParameterDefinitionFor,
  parseAbilityParameterDefinitionCatalog,
  resolveAbilityInstanceData,
  type AbilityInstanceData,
  type AbilityInstanceParameterStatus,
  type AbilityParameterDefinitionCatalog,
} from '#shared/abilityAutomation/parameters'
import { ABILITY_RULESET_PROVENANCE, type CanonicalAbilityCatalog } from '#shared/abilityAutomation/ruleset'

export interface SheetAbilityInstanceSource {
  readonly name: string
  readonly automation?: AbilityInstanceData
}

export interface ResolvedSheetAbilityInstance {
  readonly canonicalId: string
  readonly instanceId: string
  readonly parameterStatus: AbilityInstanceParameterStatus
  readonly parameterData: AbilityInstanceData | null
}

export type SheetAbilityInstanceErrorCode =
  | 'duplicate-instance-id'
  | 'invalid-parameter-metadata'

export class SheetAbilityInstanceError extends Error {
  readonly code: SheetAbilityInstanceErrorCode

  constructor(code: SheetAbilityInstanceErrorCode, detail: string) {
    super(detail)
    this.name = 'SheetAbilityInstanceError'
    this.code = code
  }
}

const fail = (code: SheetAbilityInstanceErrorCode, detail: string): never => {
  throw new SheetAbilityInstanceError(code, detail)
}

const canonicalEntries = Object.entries(canonicalAbilitiesJson)
  .sort(([left], [right]) => left === right ? 0 : left < right ? -1 : 1)
const runtimeCanonicalCatalog: CanonicalAbilityCatalog = Object.freeze({
  rulesetId: ABILITY_RULESET_PROVENANCE.rulesetId,
  canonicalizationVersion: ABILITY_RULESET_PROVENANCE.canonicalization.version,
  sourceDataSha256: ABILITY_RULESET_PROVENANCE.sourceData.sha256,
  abilities: Object.freeze(canonicalEntries.map(([canonicalId, source]) => Object.freeze({
    canonicalId,
    displayName: canonicalId,
    source,
  }))),
  knownSourceGaps: ABILITY_RULESET_PROVENANCE.canonicalization.knownSourceGaps,
  excludedHomebrewSourceKeys: Object.freeze([]),
})

export const RUNTIME_ABILITY_PARAMETER_DEFINITIONS: AbilityParameterDefinitionCatalog = (() => {
  try {
    return parseAbilityParameterDefinitionCatalog(parameterDefinitionsJson, runtimeCanonicalCatalog)
  }
  catch (error) {
    return fail(
      'invalid-parameter-metadata',
      error instanceof Error ? error.message : 'Ability parameter metadata is invalid.',
    )
  }
})()

export const abilityRequiresInstanceParameters = (canonicalId: string): boolean => (
  abilityParameterDefinitionFor(RUNTIME_ABILITY_PARAMETER_DEFINITIONS, canonicalId) !== null
)

/** Resolve sheet rows by exact canonical name; legacy display suffixes are never parsed. */
export const resolveSheetAbilityInstances = (
  values: readonly SheetAbilityInstanceSource[] | null | undefined,
): readonly ResolvedSheetAbilityInstance[] => {
  const result: ResolvedSheetAbilityInstance[] = []
  for (const [index, value] of (values ?? []).entries()) {
    if (!Object.prototype.hasOwnProperty.call(canonicalAbilitiesJson, value.name)) continue
    const resolved = resolveAbilityInstanceData(
      value.automation,
      value.name,
      RUNTIME_ABILITY_PARAMETER_DEFINITIONS,
    )
    result.push(Object.freeze({
      canonicalId: value.name,
      instanceId: resolved.data?.instanceId ?? `legacy:${index}`,
      parameterStatus: resolved.status,
      parameterData: resolved.data,
    }))
  }
  const ids = result.map(entry => entry.instanceId)
  if (new Set(ids).size !== ids.length) {
    fail('duplicate-instance-id', 'Sheet abilities must have unique stable instance IDs.')
  }
  return Object.freeze(result)
}
