import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  buildTokenSendOutOptionsForPlacement,
  getSendOutThrowDistance,
  isSendOutPositionWithinThrowRange,
} from '~/utils/mapTokenSendOut'

const pokemonSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'sparky',
  nickname: 'Sparky',
  species: 'Pikachu',
  level: 12,
  ...overrides,
})

const trainerSheet = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 5,
  currentTeam: ['sparky'],
  ...overrides,
}) as TrainerSheet

const placement = (overrides: Partial<SheetPlacement> = {}): SheetPlacement => ({
  id: 'trainer-1',
  sheetKind: 'trainer',
  sheetSlug: 'ash',
  position: { x: 5, y: 1, z: 5 },
  ...overrides,
})

const spawned = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id: 'token',
  species: 'Token',
  slug: 'token',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/token.png',
  entityKind: 'pokemon',
  sheetKind: 'pokemon',
  sheetSlug: 'token',
  position: { x: 0, y: 0, z: 0 },
  level: 1,
  currentHp: 1,
  maxHp: 1,
  atk: 1,
  satk: 1,
  def: 1,
  sdef: 1,
  defenderTypes: [],
  combatStages: {},
  conditions: [],
  tokenItems: [],
  ...overrides,
} as SpawnedPokemon)

describe('map token send-out helpers', () => {
  it('builds preview options from a trainer current team', () => {
    const sheets = {
      pokemon: new Map([['sparky', pokemonSheet()]]),
      trainer: new Map([['ash', trainerSheet({ currentTeam: ['sparky', 'missing', 'sparky'] })]]),
    }

    const options = buildTokenSendOutOptionsForPlacement(placement(), sheets)

    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({
      pokemonSlug: 'sparky',
      label: 'Sparky (Pikachu)',
      species: 'Pikachu',
      level: 12,
    })
    expect(options[0]?.throwRange).toBe(6)
    expect(options[0]?.preview).toMatchObject({
      id: 'sendout-preview:trainer-1:sparky',
      sheetKind: 'pokemon',
      sheetSlug: 'sparky',
      position: { x: 5, y: 1, z: 5 },
    })
  })

  it('measures 3D throw distance against the resolved Trainer Throwing Range', () => {
    const trainer = spawned({ id: 'trainer', base: 1, position: { x: 5, y: 1, z: 5 } })
    const pokemon = spawned({ base: 1 })

    expect(getSendOutThrowDistance({ trainer, pokemon, position: { x: 11, y: 1, z: 5 } })).toBe(6)
    expect(getSendOutThrowDistance({
      trainer,
      pokemon: spawned({ base: 2, clearance: 2 }),
      position: { x: 11, y: 1, z: 5 },
    })).toBe(6)
    expect(isSendOutPositionWithinThrowRange({
      trainer,
      pokemon,
      position: { x: 5, y: 7, z: 5 },
      range: 6,
    })).toBe(true)
    expect(isSendOutPositionWithinThrowRange({
      trainer,
      pokemon,
      position: { x: 5, y: 8, z: 5 },
      range: 6,
    })).toBe(false)
  })
})
