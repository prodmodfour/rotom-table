import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import lifecycle from '~~/data/complete-play-loop/equipment-lifecycle.v1.json'
import definitions from '~~/data/complete-play-loop/equipment-definitions.v1.json'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-049 reviewed equipment lifecycle contract', () => {
  it('binds durability only to explicit reviewed configuration fields', () => {
    expect(lifecycle).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-049',
      authority: { runtimeProseParsing: false, clientStateTrusted: false },
      durability: {
        serializedStateKey: 'equipmentDurability',
        breakAtCurrent: 0,
        unsupportedDamagePolicy: 'guided-narrative-breakage-or-no-mutation',
      },
      sourceLoss: {
        futureContributions: 'withdraw-immediately',
        futureGrants: 'withdraw-immediately',
        futureProviderSubscriptions: 'withdraw-immediately',
        acceptedDurableEffects: 'survive-source-loss',
      },
    })
    expect(sha256('data/complete-play-loop/equipment-definitions.v1.json'))
      .toBe(lifecycle.equipmentDefinitionsFileSha256)
    for (const supported of lifecycle.durability.supportedDefinitions) {
      const definition = definitions.definitions.find(row => row.canonicalItemId === supported.canonicalItemId)
      expect(definition?.configuration?.configurationId).toBe(supported.configurationId)
      const field = definition?.configuration?.fields.find(row => row.key === supported.configurationField)
      expect(field).toMatchObject({ kind: 'integer-enum', values: supported.maximumValues })
    }
  })

  it('requires exact durable reasons, custody continuity, GM evidence, and private serialized state', () => {
    expect(lifecycle.activity).toMatchObject({
      statuses: ['active', 'inactive', 'suppressed', 'broken'],
      priority: ['broken', 'inactive', 'suppressed', 'active'],
      exactReasonRemoval: true,
      unknownReasonPolicy: 'preserve-and-fail-closed',
    })
    expect(lifecycle.custody).toMatchObject({
      activitySurvivesUnequip: true,
      durabilitySurvivesTransfer: true,
      revisionIncrementsOnEveryStateOrCustodyChange: true,
    })
    expect(lifecycle.adjudication).toMatchObject({
      role: 'gm-only', evidenceNoteRequired: true, evidenceNoteDefinesMechanics: false,
      noOpPolicy: 'reject', replayPolicy: 'exact-command-no-duplicate-change',
    })
    expect(lifecycle.privacy.playerProjectionOmits).toContain('serialized durability state')
  })
})
