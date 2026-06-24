import { describe, expect, it } from 'vitest'
import { resolveCanonicalMoveEntryForPlacement } from '~/utils/authoritativeMoveEntries'
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from '~/utils/moveAutomation'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const placement = (overrides: Partial<SheetPlacement> = {}): SheetPlacement => ({
  id: 'actor-token',
  sheetKind: 'pokemon',
  sheetSlug: 'actor',
  position: { x: 0, y: 0, z: 0 },
  ...overrides,
})

const pokemonSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'actor',
  nickname: 'Actor',
  species: 'Pikachu',
  level: 10,
  movelist: [{ name: 'Tackle' }],
  ...overrides,
})

const trainerSheet = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'trainer',
  name: 'Trainer',
  level: 5,
  movelist: [{ name: 'Tackle' }],
  ...overrides,
})

const token = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id: 'actor-token',
  species: 'Actor',
  slug: 'pikachu',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprite.png',
  entityKind: 'pokemon',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: 'actor',
  level: 10,
  currentHp: 30,
  maxHp: 30,
  atk: 10,
  satk: 8,
  def: 5,
  sdef: 5,
  defenderTypes: [],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
  ...overrides,
})

const fakeScript = (moveName: string): MoveAutomationScript => ({
  kind: 'explicit',
  moveName,
  version: 1,
  targetMode: 'self',
  targetCount: 1,
  damaging: false,
  requiresAccuracy: false,
  damageBase: null,
  damageClass: 'Status',
  type: 'Normal',
  ac: null,
  range: 'Self',
  effect: 'Test move.',
  keywords: ['Self'],
  criticalRange: null,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

const withRegisteredMoveAutomationScript = async <T>(script: MoveAutomationScript, run: () => T | Promise<T>): Promise<T> => {
  const scripts = EXPLICIT_MOVE_AUTOMATION_SCRIPTS as Map<string, MoveAutomationScript>
  const previous = scripts.get(script.moveName)
  scripts.set(script.moveName, script)
  try {
    return await run()
  } finally {
    if (previous) scripts.set(script.moveName, previous)
    else scripts.delete(script.moveName)
  }
}

describe('canonical authoritative move-entry resolution', () => {
  it('resolves Pokémon and Trainer sheet moves', () => {
    const pokemonResult = resolveCanonicalMoveEntryForPlacement({
      placement: placement(),
      token: token(),
      sheets: { pokemon: new Map([['actor', pokemonSheet()]]), trainer: new Map() },
      moveName: 'Tackle',
    })
    expect(pokemonResult).toMatchObject({ ok: true })
    expect(pokemonResult.ok ? pokemonResult.entry.script.moveName : null).toBe('Tackle')

    const trainerResult = resolveCanonicalMoveEntryForPlacement({
      placement: placement({ sheetKind: 'trainer', sheetSlug: 'trainer' }),
      token: token({ sheetKind: 'trainer', sheetSlug: 'trainer', defenderTypes: [] }),
      sheets: { pokemon: new Map(), trainer: new Map([['trainer', trainerSheet()]]) },
      moveName: 'Tackle',
    })
    expect(trainerResult).toMatchObject({ ok: true })
    expect(trainerResult.ok ? trainerResult.entry.script.moveName : null).toBe('Tackle')
  })

  it('resolves automatic Struggle and applies Combat Skill adjustments', () => {
    const result = resolveCanonicalMoveEntryForPlacement({
      placement: placement(),
      token: token({ combatSkillRankValue: 5 }),
      sheets: { pokemon: new Map([['actor', pokemonSheet({ movelist: [] })]]), trainer: new Map() },
      moveName: 'Struggle',
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error('expected Struggle to resolve')
    expect(result.entry.automatic).toBe(true)
    expect(result.entry.script.ac).toBe(3)
    expect(result.entry.script.damageBase).toBe(5)
    expect(result.entry.damageFormula).toBe('1d8+8')
  })

  it('applies STAB and Loyalty damage-base mechanics like the current client flow', () => {
    const stab = resolveCanonicalMoveEntryForPlacement({
      placement: placement(),
      token: token({ defenderTypes: ['Normal'] }),
      sheets: { pokemon: new Map([['actor', pokemonSheet({ movelist: [{ name: 'Tackle' }] })]]), trainer: new Map() },
      moveName: 'Tackle',
    })
    expect(stab.ok ? stab.entry.script.damageBase : null).toBe(6)
    expect(stab.ok ? stab.entry.damageFormula : null).toBe('2d6+8')

    const loyalty = resolveCanonicalMoveEntryForPlacement({
      placement: placement(),
      token: token({ loyalty: 4 }),
      sheets: { pokemon: new Map([['actor', pokemonSheet({ movelist: [{ name: 'Return' }] })]]), trainer: new Map() },
      moveName: 'Return',
    })
    expect(loyalty.ok ? loyalty.entry.script.damageBase : null).toBe(7)
    expect(loyalty.ok ? loyalty.entry.damageFormula : null).toBe('2d6+10')
  })

  it('rejects condition-blocked and usage-blocked moves while keeping untracked moves resolvable', async () => {
    const blocked = resolveCanonicalMoveEntryForPlacement({
      placement: placement(),
      token: token({ conditions: ['Disabled: Tackle'] }),
      sheets: { pokemon: new Map([['actor', pokemonSheet()]]), trainer: new Map() },
      moveName: 'Tackle',
    })
    expect(blocked).toMatchObject({ ok: false, reason: 'condition-blocked' })

    const untracked = resolveCanonicalMoveEntryForPlacement({
      placement: placement(),
      token: token(),
      sheets: { pokemon: new Map([['actor', pokemonSheet()]]), trainer: new Map() },
      moveName: 'Tackle',
    })
    expect(untracked).toMatchObject({ ok: true })
    expect(untracked.ok ? untracked.entry.usage : null).toBeNull()

    await withRegisteredMoveAutomationScript(fakeScript('Scene Test Move'), () => {
      const scene = resolveCanonicalMoveEntryForPlacement({
        placement: placement(),
        token: token(),
        sheets: { pokemon: new Map([['actor', pokemonSheet({ movelist: [{ name: 'Scene Test Move', frequency: 'Scene' }] })]]), trainer: new Map() },
        moveName: 'Scene Test Move',
        usageContext: {
          mapMoveUsage: { byPlacementId: { 'actor-token': { 'scene-test-move': { moveName: 'Scene Test Move', frequency: 'scene', uses: 1 } } } },
        },
      })
      expect(scene).toMatchObject({ ok: false, reason: 'usage-blocked' })
    })

    await withRegisteredMoveAutomationScript(fakeScript('Daily Test Move'), () => {
      const daily = resolveCanonicalMoveEntryForPlacement({
        placement: placement(),
        token: token(),
        sheets: { pokemon: new Map([['actor', pokemonSheet({
          movelist: [{ name: 'Daily Test Move', frequency: 'Daily' }],
          moveUsage: { daily: { 'daily-test-move': { moveName: 'Daily Test Move', uses: 1 } } },
        })]]), trainer: new Map() },
        moveName: 'Daily Test Move',
        usageContext: {
          sheetMoveUsage: { daily: { 'daily-test-move': { moveName: 'Daily Test Move', uses: 1 } } },
        },
      })
      expect(daily).toMatchObject({ ok: false, reason: 'usage-blocked' })
    })
  })

  it('rejects EOT usage when the authoritative round has not advanced enough', () => {
    const result = resolveCanonicalMoveEntryForPlacement({
      placement: placement(),
      token: token(),
      sheets: { pokemon: new Map([['actor', pokemonSheet({ movelist: [{ name: 'Swords Dance' }] })]]), trainer: new Map() },
      moveName: 'Swords Dance',
      usageContext: {
        currentRound: 2,
        mapMoveUsage: { byPlacementId: { 'actor-token': { 'swords-dance': { moveName: 'Swords Dance', frequency: 'eot', uses: 1, lastUsedRound: 1 } } } },
      },
    })

    expect(result).toMatchObject({ ok: false, reason: 'usage-blocked' })
  })
})
