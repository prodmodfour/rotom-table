import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import contractJson from '../../data/complete-play-loop/inventory-source-selection.v1.json'
import { readOptionalLocalUiArtifact } from '../helpers/localUiArtifacts'

const contract = contractJson as any
const root = resolve(import.meta.dirname, '../..')

describe('P8-062 inventory source selection data contract', () => {
  it('versions exact source projection, selection, and stable transfer authority', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, ticket: 'P8-062', status: 'implemented' })
    expect(contract.projection).toEqual(expect.objectContaining({
      rowLabelRule: 'Row (section-local rowIndex + 1)',
      grouping: expect.stringMatching(/exact non-null canonical item identity/u),
      identity: expect.stringMatching(/never the inventory row/u),
    }))
    expect(contract.selection).toEqual(expect.objectContaining({
      changeBehavior: expect.stringMatching(/clear target-specific choices/u),
      submission: expect.stringMatching(/map server-side to the private source row/u),
      staleBehavior: expect.stringMatching(/never substitute another same-name row/u),
    }))
    expect(contract.transfers.trainerToGroup).toMatch(/stable trainerItemId/u)
    expect(contract.transfers.legacy).toMatch(/current UI never submits one/u)
  })

  it('limits local persistence to safe presentation ordering', () => {
    expect(contract.localPreference.allowedFields).toEqual([
      'schemaVersion', 'preferredContainerKind', 'preferredSection',
    ])
    expect(contract.localPreference.effect).toMatch(/presentation ordering only/u)
    expect(contract.forbiddenPresentationFields).toEqual(expect.arrayContaining([
      'trainerSlug', 'groupSlug', 'rowId', 'sourceInstanceId', 'serializedInstanceId',
      'offerId', 'operationId', 'profileId', 'canonicalDefinitionSha256',
      'ownershipEvidence', 'privateNotes', 'provenance',
    ]))
  })

  it('binds the current runtime files and accepted visual target', () => {
    for (const path of contract.runtimeContracts) expect(existsSync(resolve(root, path)), path).toBe(true)
    expect(contract.ui.revalidationCopy).toBe('Selection and revision are rechecked when submitted.')
    expect(contract.ui.stateCues).toEqual(expect.arrayContaining(['radio mark', 'Selected text', 'selected inventory row aria-current']))
    const mockup = readOptionalLocalUiArtifact(root, contract.ui.acceptedMockup)
    if (mockup) expect(mockup.byteLength).toBeGreaterThan(0)
  })
})
