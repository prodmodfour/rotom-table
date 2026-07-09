import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import rulesetJson from '../../data/move-automation/ruleset.json'
import {
  MOVE_RULESET_PROVENANCE,
  MoveRulesetValidationError,
  loadCanonicalMoveCatalog,
  parseMoveRulesetProvenance,
  sha256Hex,
} from '#shared/moveAutomation/ruleset'

const movesPath = join(process.cwd(), 'data', 'reference', 'moves.json')
const sourceBytes = (): Uint8Array => readFileSync(movesPath)

const provenanceForSource = async (source: string | Uint8Array) => {
  const provenance = structuredClone(rulesetJson)
  provenance.sourceData.sha256 = await sha256Hex(source)
  return provenance
}

const expectRulesetError = async (
  operation: Promise<unknown>,
  code: MoveRulesetValidationError['code'],
): Promise<void> => {
  try {
    await operation
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveRulesetValidationError)
    expect((error as MoveRulesetValidationError).code).toBe(code)
  }
}

describe('canonical move ruleset provenance', () => {
  it('loads the frozen 776-move catalog from the exact reviewed source bytes', async () => {
    const catalog = await loadCanonicalMoveCatalog(sourceBytes())

    expect(catalog.rulesetId).toBe('rotom-table-reference-moves-v1')
    expect(catalog.canonicalizationVersion).toBe(1)
    expect(catalog.sourceDataSha256).toBe(MOVE_RULESET_PROVENANCE.sourceData.sha256)
    expect(catalog.moves).toHaveLength(776)
    expect(catalog.moves.map(({ canonicalId }) => canonicalId)).toEqual(
      [...catalog.moves.map(({ canonicalId }) => canonicalId)].sort(),
    )
    expect(new Set(catalog.moves.map(({ canonicalId }) => canonicalId)).size).toBe(776)
    expect(catalog.excludedParserJunkSourceKeys).toEqual([
      'The first line contains the Name of the Move. This',
    ])
    expect(catalog.excludedHomebrewSourceKeys).toEqual([])
    expect(catalog.moves.some(({ canonicalId }) => canonicalId.startsWith('The first line'))).toBe(false)
  })

  it('keeps the base move and every typed Struggle variant as distinct canonical identities', async () => {
    const catalog = await loadCanonicalMoveCatalog(sourceBytes())
    const struggleIds = catalog.moves
      .map(({ canonicalId }) => canonicalId)
      .filter((canonicalId) => /^Struggle(?:$| \()/.test(canonicalId))

    expect(struggleIds).toEqual([...MOVE_RULESET_PROVENANCE.struggleVariants.canonicalSourceKeys].sort())
    expect(struggleIds).toHaveLength(15)
  })

  it('records no supplement or errata source that has not been verified', () => {
    expect(MOVE_RULESET_PROVENANCE.verifiedSupplementSources).toEqual([])
    expect(MOVE_RULESET_PROVENANCE.verifiedErrataSources).toEqual([])
  })

  it('rejects any source-byte drift until the provenance hash is intentionally updated', async () => {
    const changedSource = `${new TextDecoder().decode(sourceBytes())} `

    await expectRulesetError(loadCanonicalMoveCatalog(changedSource), 'source-hash-mismatch')

    const reviewedProvenance = await provenanceForSource(changedSource)
    await expect(loadCanonicalMoveCatalog(changedSource, reviewedProvenance)).resolves.toMatchObject({
      sourceDataSha256: reviewedProvenance.sourceData.sha256,
      moves: expect.arrayContaining([
        expect.objectContaining({ canonicalId: 'Tackle', displayName: 'Tackle' }),
      ]),
    })
  })

  it('enforces the reviewed parser-junk exclusion policy after hash review', async () => {
    const source = JSON.parse(new TextDecoder().decode(sourceBytes())) as Record<string, unknown>
    source['Unexpected parser prose'] = {
      name: 'Unexpected parser prose',
      type: 'Not a canonical type',
    }
    const changedSource = JSON.stringify(source)
    const reviewedProvenance = await provenanceForSource(changedSource)

    await expectRulesetError(
      loadCanonicalMoveCatalog(changedSource, reviewedProvenance),
      'parser-junk-policy-mismatch',
    )
  })

  it('keeps explicitly namespaced homebrew records outside the canonical catalog', async () => {
    const source = JSON.parse(new TextDecoder().decode(sourceBytes())) as Record<string, unknown>
    source['homebrew:Example Move'] = {
      name: 'homebrew:Example Move',
      type: 'Normal',
    }
    const changedSource = JSON.stringify(source)
    const reviewedProvenance = await provenanceForSource(changedSource)
    const catalog = await loadCanonicalMoveCatalog(changedSource, reviewedProvenance)

    expect(catalog.moves).toHaveLength(776)
    expect(catalog.moves.some(({ canonicalId }) => canonicalId === 'homebrew:Example Move')).toBe(false)
    expect(catalog.excludedHomebrewSourceKeys).toEqual(['homebrew:Example Move'])
  })

  it('rejects provenance with unknown policy fields', () => {
    const provenance = {
      ...structuredClone(rulesetJson),
      canonicalization: {
        ...structuredClone(rulesetJson.canonicalization),
        unreviewedPolicy: true,
      },
    }

    expect(() => parseMoveRulesetProvenance(provenance)).toThrow(/unknown: unreviewedPolicy/)
  })
})
