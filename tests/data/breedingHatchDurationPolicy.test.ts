import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')

interface AcceptedDuration {
  sourceValue: string
  days: number
  campaignMinutes: number
  recordCount: number
}
interface VariationPolicy {
  id: string
  roll: null | { expression: string, minimumTotal: number, maximumTotal: number, rollOnceAt: string }
  minimumPercent: number
  maximumPercent: number
  resolution: string
}
interface HatchDurationPolicy {
  schemaVersion: number
  policyId: string
  rulesetId: string
  rulesetDefinitionSha256: string
  sourceManifestSha256: string
  definitionSha256: string
  definition: {
    parser: {
      version: number
      inputField: string
      inputGrammar: string
      genericRegexDiagnosticOnly: string
      caseNormalization: string
      whitespaceNormalization: string
      acceptedSourceValues: AcceptedDuration[]
      nullOrMissing: string
      unknownWellFormed: string
      malformed: string
    }
    units: Record<string, string | number>
    variationPolicies: VariationPolicy[]
    campaignClock: Record<string, string>
    incubation: { fields: string[] } & Record<string, string | string[]>
    modifierCheckpoints: Array<{ id: string, definition: string }>
    knownModifierSemantics: Array<Record<string, string | number>>
    sourceKinds: Record<string, string>
    failureReasonIds: string[]
    currentSourceDiagnostics: Record<string, number>
  }
}
interface PokedexRow { hatch_rate?: string | null }

const policy = readJson<HatchDurationPolicy>('data/breeding-automation/hatch-duration-policy.json')
const ruleset = readJson<{ rulesetId: string, definitionSha256: string }>('data/breeding-automation/ruleset.json')

const parseDuration = (value: unknown): number | null => {
  if (typeof value !== 'string') return null
  return policy.definition.parser.acceptedSourceValues.find(row => row.sourceValue === value)?.campaignMinutes ?? null
}

const variedTarget = (average: number, percent: number): number => Math.ceil(average * percent / 100)

describe('breeding hatch-duration and campaign-time policy', () => {
  it('is source- and ruleset-bound with stable deterministic serialization', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      policyId: 'ptu-1.05-breeding-hatch-duration-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
    })
    expect(policy.sourceManifestSha256).toBe(sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))))
    expect(policy.definitionSha256).toBe(sha256(stableJsonStringify(policy.definition)))
  })

  it('accepts only reviewed exact source values and converts days to campaign minutes', () => {
    expect(policy.definition.parser).toMatchObject({
      version: 1,
      inputField: 'hatch_rate',
      inputGrammar: 'exact-reviewed-source-value',
      caseNormalization: 'forbidden',
      whitespaceNormalization: 'forbidden',
      nullOrMissing: 'unavailable',
      unknownWellFormed: 'source-drift-unavailable',
      malformed: 'malformed-source-unavailable',
    })
    expect(policy.definition.parser.acceptedSourceValues).toEqual([
      { sourceValue: '2 Days', days: 2, campaignMinutes: 2_880, recordCount: 1 },
      { sourceValue: '4 Days', days: 4, campaignMinutes: 5_760, recordCount: 9 },
      { sourceValue: '7 Days', days: 7, campaignMinutes: 10_080, recordCount: 60 },
      { sourceValue: '10 Days', days: 10, campaignMinutes: 14_400, recordCount: 276 },
      { sourceValue: '13 Days', days: 13, campaignMinutes: 18_720, recordCount: 57 },
      { sourceValue: '16 Days', days: 16, campaignMinutes: 23_040, recordCount: 16 },
      { sourceValue: '20 Days', days: 20, campaignMinutes: 28_800, recordCount: 6 },
      { sourceValue: '25 Days', days: 25, campaignMinutes: 36_000, recordCount: 18 },
      { sourceValue: '40 Days', days: 40, campaignMinutes: 57_600, recordCount: 29 },
      { sourceValue: '75 Days', days: 75, campaignMinutes: 108_000, recordCount: 79 },
    ])
    for (const row of policy.definition.parser.acceptedSourceValues) {
      expect(row.campaignMinutes, row.sourceValue).toBe(row.days * 1_440)
      expect(parseDuration(row.sourceValue), row.sourceValue).toBe(row.campaignMinutes)
    }
    expect(parseDuration(null)).toBeNull()
    expect(parseDuration('10 days')).toBeNull()
    expect(parseDuration(' 10 Days')).toBeNull()
    expect(parseDuration('10 Days ')).toBeNull()
    expect(parseDuration('3 Days')).toBeNull()
    expect(parseDuration('ten days')).toBeNull()
  })

  it('freezes bounded fixed, replay-safe random, and audited GM variation semantics', () => {
    expect(policy.definition.variationPolicies).toEqual([
      { id: 'fixed-average', roll: null, minimumPercent: 100, maximumPercent: 100, resolution: 'target=average' },
      {
        id: 'server-random-half-to-double',
        roll: { expression: '1d151+49', minimumTotal: 50, maximumTotal: 200, rollOnceAt: 'egg-acceptance' },
        minimumPercent: 50,
        maximumPercent: 200,
        resolution: 'target=ceil(average*rollTotal/100)',
      },
      {
        id: 'gm-within-half-to-double',
        roll: null,
        minimumPercent: 50,
        maximumPercent: 200,
        resolution: 'server-validates-integer-target-between-ceil(average/2)-and-average*2',
      },
    ])
    expect(variedTarget(2_881, 50)).toBe(1_441)
    expect(variedTarget(2_881, 100)).toBe(2_881)
    expect(variedTarget(2_881, 200)).toBe(5_762)
    expect(policy.definition.units).toMatchObject({
      authoritativeUnit: 'campaign-minute',
      campaignMinutesPerHour: 60,
      campaignMinutesPerDay: 1_440,
      minimumDurationMinutes: 1,
      maximumDurationMinutes: 31_536_000,
      arithmetic: 'non-negative-safe-integers-only',
      fractionRounding: 'ceil-final-target-minutes',
      wallClockMilliseconds: 'presentation-only-never-mechanics',
    })
  })

  it('makes clock advancement revisioned and independent of process, browser, timezone, and calendar time', () => {
    expect(policy.definition.campaignClock).toEqual({
      clockValue: 'non-negative-safe-integer-campaign-minute',
      clockRevision: 'monotonic-non-negative-safe-integer',
      advanceIdentity: 'stable-unique-advancement-id',
      duplicateAdvance: 'return-stored-result',
      reversedOrContradictoryAdvance: 'reject',
      progressDelta: 'max(0,new-clock-minute-last-applied-clock-minute)',
      processTimer: 'forbidden',
      browserTimer: 'forbidden',
      timezone: 'presentation-only',
      calendar: 'presentation-only',
    })
    expect(policy.definition.incubation).toMatchObject({
      durationSnapshot: 'egg-acceptance',
      readyWhen: 'accumulated-campaign-minutes-greater-than-or-equal-target-campaign-minutes',
      storedProgress: 'clamp-zero-to-target',
      transferPolicy: 'continues',
      storagePolicy: 'continues',
      parentOrBreederLossPolicy: 'continues',
      pausePolicy: 'explicit-audited-operation-only',
      manualReadyPolicy: 'audited-gm-operation-does-not-rewrite-elapsed-time',
    })
    expect(policy.definition.incubation.fields).toEqual([
      'average-campaign-minutes', 'variation-policy-id', 'variation-roll-id-or-null',
      'target-campaign-minutes', 'accumulated-campaign-minutes', 'last-clock-revision',
      'last-clock-minute', 'ready-at-clock-minute-or-null',
    ])
  })

  it('binds item and Capability modifiers to explicit checkpoints rather than map Egg state', () => {
    expect(policy.definition.modifierCheckpoints.map(row => row.id)).toEqual(['snapshot', 'continuous', 'operation'])
    expect(policy.definition.knownModifierSemantics).toEqual([
      {
        sourceKind: 'item',
        canonicalId: 'Egg Warmer',
        checkpoint: 'continuous',
        effect: 'progress-rate-multiplier',
        numerator: 2,
        denominator: 1,
      },
      {
        sourceKind: 'capability',
        canonicalId: 'Egg Warmer',
        checkpoint: 'operation',
        effect: 'target-reduction-campaign-minutes',
        roll: '1d10',
        resultOneReductionMinutes: 0,
        resultTwoThroughTenMultiplierMinutes: 60,
      },
    ])
    expect(policy.definition.sourceKinds).toEqual({
      breeding: 'compiled-child-species-duration',
      fossil: 'compiled-child-species-duration-unless-provider-override',
      gm: 'typed-bounded-duration-required',
      'feature-artificial': 'authoritative-provider-duration-snapshotted',
    })
  })

  it('keeps the frozen source histogram complete and all failures closed', () => {
    const pokedex = readJson<PokedexRow[]>('data/reference/pokedex.json')
    const recognized = new Set(policy.definition.parser.acceptedSourceValues.map(row => row.sourceValue))
    const histogram = new Map<string, number>()
    let missing = 0
    let unknownWellFormed = 0
    let malformed = 0
    const diagnosticPattern = new RegExp(policy.definition.parser.genericRegexDiagnosticOnly)
    for (const row of pokedex) {
      if (!row.hatch_rate) {
        missing += 1
        continue
      }
      histogram.set(row.hatch_rate, (histogram.get(row.hatch_rate) ?? 0) + 1)
      if (!recognized.has(row.hatch_rate)) {
        if (diagnosticPattern.test(row.hatch_rate)) unknownWellFormed += 1
        else malformed += 1
      }
    }
    expect(policy.definition.parser.acceptedSourceValues.map(row => ({ sourceValue: row.sourceValue, recordCount: row.recordCount })))
      .toEqual([...histogram].sort(([left], [right]) => Number.parseInt(left) - Number.parseInt(right))
        .map(([sourceValue, recordCount]) => ({ sourceValue, recordCount })))
    expect(policy.definition.currentSourceDiagnostics).toEqual({
      recordCount: pokedex.length,
      recognizedDurationRecordCount: pokedex.length - missing - unknownWellFormed - malformed,
      missingDurationRecordCount: missing,
      unknownWellFormedRecordCount: unknownWellFormed,
      malformedDurationRecordCount: malformed,
    })
    expect(new Set(policy.definition.failureReasonIds).size).toBe(policy.definition.failureReasonIds.length)
    expect(policy.definition.failureReasonIds.every(id => /^breeding\.(?:hatch-duration|campaign-clock|incubation)\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))).toBe(true)
  })
})
