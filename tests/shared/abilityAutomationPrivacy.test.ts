import { describe, expect, it } from 'vitest'
import privacyMatrixJson from '../../data/ability-automation/privacy-matrix.json'
import {
  ABILITY_AUTOMATION_THREAT_IDS,
  AbilityAutomationPrivacyValidationError,
  parseAbilityAutomationPrivacyMatrix,
  type AbilityAutomationPrivacyValidationCode,
} from '#shared/abilityAutomation/privacy'

const expectPrivacyError = (
  value: unknown,
  code: AbilityAutomationPrivacyValidationCode,
  path?: string,
): void => {
  try {
    parseAbilityAutomationPrivacyMatrix(value)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityAutomationPrivacyValidationError)
    expect((error as AbilityAutomationPrivacyValidationError).code).toBe(code)
    if (path) expect((error as AbilityAutomationPrivacyValidationError).path).toBe(path)
  }
}

describe('ability automation privacy threat matrix', () => {
  it('covers hidden, copied, suppressed, eligibility, ownership, options, state, and telemetry threats', () => {
    const matrix = parseAbilityAutomationPrivacyMatrix(privacyMatrixJson)

    expect(matrix.schemaVersion).toBe(1)
    expect(matrix.defaultDecision).toBe('deny')
    expect(matrix.threats.map(threat => threat.id)).toEqual(ABILITY_AUTOMATION_THREAT_IDS)
    expect(matrix.threats).toHaveLength(8)
    expect(matrix.assets).toHaveLength(19)
    expect(matrix.threats.every(threat => threat.controlIds.includes('unauthenticated-deny'))).toBe(true)
  })

  it('denies unauthenticated viewers and map participants access to every secret asset', () => {
    const matrix = parseAbilityAutomationPrivacyMatrix(privacyMatrixJson)

    for (const asset of matrix.assets) {
      expect(asset.disclosures.unauthenticated, asset.id).toBe('none')
      if (asset.sensitivity === 'secret') {
        expect(asset.disclosures['map-participant'], asset.id).toBe('none')
      }
    }
  })

  it('exposes prompts and stable options only through authorized responder projections', () => {
    const matrix = parseAbilityAutomationPrivacyMatrix(privacyMatrixJson)
    const assets = new Map(matrix.assets.map(asset => [asset.id, asset]))

    expect(assets.get('response.authorized-prompt')?.disclosures).toMatchObject({
      'eligible-responder': 'authorized-projection',
      'map-participant': 'none',
      'authorized-operator': 'none',
    })
    expect(assets.get('response.legal-options')?.disclosures).toMatchObject({
      'eligible-responder': 'authorized-projection',
      'map-participant': 'none',
    })
    expect(assets.get('response.effect-program')?.disclosures).toEqual({
      'server-authority': 'full',
      'authorized-gm': 'none',
      'source-controller': 'none',
      'eligible-responder': 'none',
      'map-participant': 'none',
      'authorized-operator': 'none',
      unauthenticated: 'none',
    })
  })

  it('keeps eligibility, rolls, copy provenance, and suppression state out of public summaries', () => {
    const matrix = parseAbilityAutomationPrivacyMatrix(privacyMatrixJson)
    const assets = new Map(matrix.assets.map(asset => [asset.id, asset]))

    for (const id of [
      'trigger.eligibility',
      'roll.private-ledger',
      'projection.copy-provenance',
      'projection.suppression-state',
    ]) {
      expect(assets.get(id)?.disclosures['map-participant'], id).toBe('none')
    }
    expect(assets.get('pending.public-summary')?.disclosures['map-participant']).toBe('existence-only')
    expect(assets.get('observability.metrics')?.disclosures['authorized-operator']).toBe('aggregate-only')
  })

  it('returns detached frozen policy data', () => {
    const source = structuredClone(privacyMatrixJson)
    const matrix = parseAbilityAutomationPrivacyMatrix(source)
    source.assets[0]!.id = 'changed'

    expect(matrix.assets[0]!.id).toBe('ability.base-identity')
    expect(Object.isFrozen(matrix)).toBe(true)
    expect(Object.isFrozen(matrix.assets)).toBe(true)
    expect(Object.isFrozen(matrix.assets[0]!.disclosures)).toBe(true)
  })

  it('fails closed on unsafe defaults, disclosures, controls, and reference drift', () => {
    const allow = structuredClone(privacyMatrixJson) as Record<string, unknown>
    allow.defaultDecision = 'allow'
    expectPrivacyError(allow, 'unsafe-disclosure', 'privacyMatrix.defaultDecision')

    const unauthenticated = structuredClone(privacyMatrixJson)
    unauthenticated.assets[0]!.disclosures.unauthenticated = 'existence-only'
    expectPrivacyError(
      unauthenticated,
      'unsafe-disclosure',
      'privacyMatrix.assets[0].disclosures.unauthenticated',
    )

    const publicSecret = structuredClone(privacyMatrixJson)
    publicSecret.assets[0]!.disclosures['map-participant'] = 'existence-only'
    expectPrivacyError(
      publicSecret,
      'unsafe-disclosure',
      'privacyMatrix.assets[0].disclosures.map-participant',
    )

    const unknownControl = structuredClone(privacyMatrixJson)
    unknownControl.threats[0]!.controlIds[0] = 'trust-client'
    expectPrivacyError(
      unknownControl,
      'unknown-reference',
      'privacyMatrix.threats[0].controlIds[0]',
    )

    const inconsistent = structuredClone(privacyMatrixJson)
    inconsistent.threats[0]!.assetIds = ['ability.base-identity']
    expectPrivacyError(inconsistent, 'inconsistent-reference')

    const missingThreat = structuredClone(privacyMatrixJson)
    missingThreat.threats.pop()
    expectPrivacyError(missingThreat, 'invalid-privacy-matrix', 'privacyMatrix.threats')
  })
})
