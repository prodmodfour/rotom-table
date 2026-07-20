import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import abilitiesJson from '../../data/reference/abilities.json'
import adjudicationsJson from '../../data/ability-automation/source-adjudications.json'

const expectedCanonicalIds = [
  'Anchored',
  'Ball Fetch',
  'Illusion',
  'Klutz',
  'Multitype',
  'Receiver',
  'Transporter',
] as const

const exactKeys = (value: object): string[] => Object.keys(value).sort()

const sourceDigest = (path: string): string => createHash('sha256')
  .update(readFileSync(join(process.cwd(), path)))
  .digest('hex')

describe('reviewed ability source adjudications', () => {
  it('contains the seven deterministic parser/source repairs in canonical order', () => {
    expect(adjudicationsJson.schemaVersion).toBe(1)
    expect(adjudicationsJson.adjudications.map(entry => entry.canonicalId)).toEqual(expectedCanonicalIds)
    expect(new Set(adjudicationsJson.adjudications.map(entry => entry.canonicalId)).size).toBe(7)

    for (const entry of adjudicationsJson.adjudications) {
      expect(exactKeys(entry)).toEqual([
        'canonicalId',
        'fields',
        'reason',
        'sourceDataSha256',
        'sourcePath',
        'sourceSection',
      ])
      expect(entry.reason.trim().length).toBeGreaterThan(0)
      expect(entry.sourceDataSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(sourceDigest(entry.sourcePath)).toBe(entry.sourceDataSha256)
      expect(readFileSync(join(process.cwd(), entry.sourcePath), 'utf8')).toContain(entry.sourceSection)
      expect(Object.keys(entry.fields).length).toBeGreaterThan(0)
      expect(Object.keys(entry.fields).every(field => (
        field === 'frequency' || field === 'trigger' || field === 'effect' || field === 'bonus'
      ))).toBe(true)
    }
  })

  it('matches every adjudicated field to the immediate canonical ability authority', () => {
    const abilities = abilitiesJson as Record<string, Record<string, unknown>>
    for (const entry of adjudicationsJson.adjudications) {
      expect(abilities[entry.canonicalId]).toBeDefined()
      for (const [field, value] of Object.entries(entry.fields)) {
        expect(abilities[entry.canonicalId]?.[field], `${entry.canonicalId}.${field}`).toBe(value)
      }
    }
  })

  it('leaves no canonical ability without frequency or effect text', () => {
    const abilities = Object.values(abilitiesJson)
    expect(abilities).toHaveLength(483)
    expect(abilities.filter(ability => !ability.frequency)).toEqual([])
    expect(abilities.filter(ability => !ability.effect)).toEqual([])
  })
})
