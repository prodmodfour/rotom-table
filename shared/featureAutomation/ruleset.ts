import rulesetJson from '../../data/feature-automation/ruleset.json'

export const FEATURE_AUTOMATION_RULESET_SCHEMA_VERSION = 1 as const
export const FEATURE_AUTOMATION_RULESET_ID = 'ptu-1.05-feature-automation-v1' as const

export interface FeatureAutomationRuleset {
  readonly schemaVersion: 1
  readonly rulesetId: typeof FEATURE_AUTOMATION_RULESET_ID
  readonly runtimeAuthority: readonly ['data/reference/features.json']
  readonly catalog: {
    readonly path: 'data/reference/features.json'
    readonly entryCount: 444
    readonly bytes: number
    readonly sha256: string
    readonly gitBlob: string
  }
  readonly sourceDriftPolicy: 'fail-closed'
  readonly unknownIdentityPolicy: 'diagnostic-only'
  readonly clientAuthority: 'none'
}

const value = rulesetJson as unknown as FeatureAutomationRuleset
if (value.schemaVersion !== FEATURE_AUTOMATION_RULESET_SCHEMA_VERSION
  || value.rulesetId !== FEATURE_AUTOMATION_RULESET_ID
  || value.catalog.entryCount !== 444
  || value.catalog.path !== 'data/reference/features.json'
  || value.sourceDriftPolicy !== 'fail-closed'
  || value.unknownIdentityPolicy !== 'diagnostic-only'
  || value.clientAuthority !== 'none') {
  throw new Error('Feature automation ruleset does not preserve frozen server authority.')
}
export const FEATURE_AUTOMATION_RULESET = Object.freeze(value)
