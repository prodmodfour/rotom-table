import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import protectionsJson from '../../data/ability-automation/protections.json'
import {
  AbilityProtectionValidationError,
  abilityProtectionFor,
  parseAbilityProtectionCatalog,
} from '#shared/abilityAutomation/protections'
import {
  loadCanonicalAbilityCatalog,
  type CanonicalAbilityCatalog,
} from '#shared/abilityAutomation/ruleset'

let canonical: CanonicalAbilityCatalog

beforeAll(async () => {
  canonical = await loadCanonicalAbilityCatalog(
    readFileSync(join(process.cwd(), 'data/reference/abilities.json')),
  )
})

describe('canonical ability copy/disable/transfer protections', () => {
  it('source-binds all four exceptional protection declarations', () => {
    const catalog = parseAbilityProtectionCatalog(protectionsJson, canonical)

    expect(catalog.entries.map(entry => [
      entry.canonicalId,
      entry.copyable,
      entry.disableable,
      entry.transferable,
    ])).toEqual([
      ['Huge Power / Pure Power', true, false, true],
      ['Multitype', false, false, true],
      ['Sorcery', true, false, true],
      ['Splendorous Rider', false, true, false],
    ])
    expect(abilityProtectionFor(catalog, 'Blaze')).toEqual({
      copyable: true,
      disableable: true,
      transferable: true,
    })
    expect(abilityProtectionFor(catalog, 'Multitype')).toEqual({
      copyable: false,
      disableable: false,
      transferable: true,
    })
    expect(Object.isFrozen(catalog.entries)).toBe(true)
  })

  it('rejects stale text, provenance, duplicate identities, and executable data', () => {
    const phrase = structuredClone(protectionsJson)
    phrase.entries[0]!.sourcePhrase = 'not source text'
    expect(() => parseAbilityProtectionCatalog(phrase, canonical)).toThrow(
      AbilityProtectionValidationError,
    )

    const source = structuredClone(protectionsJson)
    source.sourceDataSha256 = 'a'.repeat(64)
    expect(() => parseAbilityProtectionCatalog(source, canonical)).toThrow(
      AbilityProtectionValidationError,
    )

    const duplicate = structuredClone(protectionsJson)
    duplicate.entries.push(structuredClone(duplicate.entries[0]!))
    expect(() => parseAbilityProtectionCatalog(duplicate, canonical)).toThrow(
      AbilityProtectionValidationError,
    )

    expect(() => parseAbilityProtectionCatalog({
      ...protectionsJson,
      entries: [() => true],
    }, canonical)).toThrow(AbilityProtectionValidationError)
  })
})
