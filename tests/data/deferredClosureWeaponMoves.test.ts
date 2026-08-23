import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import moves from '../../data/reference/moves.json'
import {
  CAPABILITY_WEAPON_MOVES,
  WEAPON_MOVE_SOURCE_SHA256,
  capabilityWeaponMove,
  isNativeCapabilityWeaponMoveName,
} from '../../shared/capabilityAutomation/weaponMoves'
import { buildContestPerformerSnapshot } from '../../shared/contests/integrations'

const NEW_MOVES = ['Bash!', 'Pierce!', 'Gouge', 'Titanic Slam', 'Bullseye', 'Deadly Strike', 'Triple Threat'] as const
const EXPECTED = {
  'Bash!': { frequency: 'EOT', ac: 2, db: 7, range: 'Melee, 1 Target' },
  'Pierce!': { frequency: 'EOT', ac: 2, db: 7, range: 'Melee, 1 Target' },
  'Gouge': { frequency: 'Scene x2', ac: 2, db: 5, range: 'Melee, 1 Target, Double Strike' },
  'Titanic Slam': { frequency: 'Scene x2', ac: 3, db: 11, range: 'Melee, 1 Target' },
  'Bullseye': { frequency: 'EOT', ac: 2, db: 6, range: 'Melee, 1 Target' },
  'Deadly Strike': { frequency: 'Scene x2', ac: 2, db: 6, range: 'Melee, 1 Target' },
  'Triple Threat': { frequency: 'Scene x2', ac: 2, db: 7, range: 'Melee, 3 Targets' },
} as const

describe('P11-005 reviewed weapon Move definitions', () => {
  it('installs exactly twelve source-bound supplemental definitions', () => {
    expect(Object.keys(CAPABILITY_WEAPON_MOVES)).toHaveLength(12)
    expect(createHash('sha256').update(readFileSync('books/markdown/core/09-gear-and-items.md')).digest('hex'))
      .toBe(WEAPON_MOVE_SOURCE_SHA256)
    for (const moveName of NEW_MOVES) {
      expect(capabilityWeaponMove(moveName)).toMatchObject({
        name: moveName,
        type: 'Normal',
        category: 'Physical',
        weaponRangePolicy: 'source-profile',
        sourceSha256: WEAPON_MOVE_SOURCE_SHA256,
        contestEligibility: {
          status: 'unavailable',
          reasonCode: 'weapon-move-no-canonical-contest-identity',
        },
        ...EXPECTED[moveName],
      })
    }
  })

  it('marks all source-bound definitions native only after reviewed execution lands', () => {
    for (const moveName of Object.keys(CAPABILITY_WEAPON_MOVES)) {
      expect(isNativeCapabilityWeaponMoveName(moveName), moveName).toBe(true)
    }
  })

  it('does not mutate the frozen Pokémon Move catalog', () => {
    expect(Object.keys(moves)).toHaveLength(777)
    for (const moveName of NEW_MOVES) expect((moves as Record<string, unknown>)[moveName]).toBeUndefined()
  })

  it('fails every weapon Move closed in Contest appeal legality', () => {
    const sheet = {
      slug: 'weapon-move-contest-subject', nickname: 'Weapon Performer', species: 'Pikachu',
      level: 10, stats: {},
      movelist: Object.values(CAPABILITY_WEAPON_MOVES),
    }
    const trainer = { slug: 'weapon-move-trainer', name: 'Weapon Trainer', level: 10, skills: {} }
    const snapshot = buildContestPerformerSnapshot({ sheet: sheet as any, trainer: trainer as any, campaignDay: 0, revision: 0 })
    for (const moveName of Object.keys(CAPABILITY_WEAPON_MOVES)) {
      expect(snapshot.moves.find(option => option.label === moveName), moveName).toMatchObject({
        available: false,
        typeId: null,
        effectId: null,
        unavailableCode: 'contest.move-identity-missing',
      })
    }
  })
})
