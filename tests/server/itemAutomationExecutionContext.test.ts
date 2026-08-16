import { describe, expect, it } from 'vitest'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { PersistedSheet } from '../../server/storage/sheetRepository'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { CRUELTY_HEALING_BLOCK_CAPABILITY_ID } from '../../server/domain/abilityAutomation/healingPrevention'
import {
  AuthoritativeItemExecutionContextError,
  buildAuthoritativeItemExecutionContext,
  type BuildAuthoritativeItemExecutionContextInput,
} from '../../server/domain/itemAutomation/executionContext'
import {
  deriveAuthoritativeItemEligibility,
  projectEncounterItemEligibility,
} from '../../server/domain/itemAutomation/eligibility'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import { applyCombatStagesToSheet } from '~/utils/sheetMutations'
import { normalizePlayerProfile } from '#shared/playerProfiles'
import { sheetItemTargetId } from '#shared/itemAutomation/sheetActions'

const trainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3, currentTeam: ['pikachu'],
  inventory: { medicalKit: [{ id: 'potion-row', name: 'Potion', qty: 2 }] },
})
const pokemon = (): CharacterSheet => ({
  slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu', level: 5, revision: 2,
  stats: { hp: { added: 0 } }, combat: { currentHp: 1 },
})
const map = (): TabletopMap => ({
  schemaVersion: 2, slug: 'arena', name: 'Arena', revision: 4,
  dimensions: { x: 8, y: 3, z: 8 }, voxels: [], createdAt: 1, updatedAt: 10,
  placements: [
    { id: 'ash-placement', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 1, y: 0, z: 1 }, sideId: 'heroes' },
    { id: 'pikachu-placement', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 2, y: 0, z: 1 }, sideId: 'heroes' },
  ],
  encounterState: {
    ...createEmptyEncounterState(),
    sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' } },
    turnResources: { 'ash-placement': createEncounterTurnResourceLedger({ placementId: 'ash-placement', round: 1 }) },
  },
  initiative: { activeId: 'ash-placement', round: 1 },
})
const persisted = (): PersistedSheet[] => [{
  kind: 'trainer', slug: 'ash', revision: 3, updatedAt: 10, sheet: trainer() as unknown as Record<string, unknown>,
}, {
  kind: 'pokemon', slug: 'pikachu', revision: 2, updatedAt: 10, sheet: pokemon() as unknown as Record<string, unknown>,
}]
const command = (readSet?: UseItemCommandV1['readSet']): UseItemCommandV1 => ({
  schemaVersion: 1,
  operationId: 'op_item_context_0001',
  context: 'encounter',
  offerId: 'offer:item:potion',
  sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
  actorParticipantId: 'ash-placement',
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 3 },
  targetIds: ['pikachu-placement'],
  choices: [{ choiceId: 'target', optionIds: ['pikachu-placement'] }],
  readSet: readSet ?? [
    { kind: 'map', id: 'arena', revision: 4 },
    { kind: 'encounter', id: 'arena', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
  ],
})

describe('authoritative item execution context and eligibility', () => {
  it('loads and detaches every consulted mutable authority before deriving legal targets', () => {
    const sourceMap = map()
    const sheets = persisted()
    const context = buildAuthoritativeItemExecutionContext({
      role: 'gm', command: command(), map: sourceMap, mapRevision: 4, persistedSheets: sheets,
    })
    expect(context.source).toMatchObject({ canonicalItemId: 'Potion', quantity: 2, rowId: 'potion-row' })
    expect(context.targets[0]).toMatchObject({ participantId: 'pikachu-placement', sheet: { revision: 2 } })
    expect(context.readSet.map(ref => ref.kind)).toEqual(['map', 'encounter', 'sheet', 'sheet'])
    const eligibility = deriveAuthoritativeItemEligibility(context)
    expect(eligibility.available).toBe(true)
    expect(eligibility.legalTargets.map(target => target.participantId)).toContain('pikachu-placement')
    sourceMap.placements[1]!.sheetSlug = 'mutated-after-snapshot'
    expect(context.map?.placements[1]?.sheetSlug).toBe('pikachu')
  })

  it('rejects a target whose mutable sheet was omitted from the read set', () => {
    const incomplete = command([
      { kind: 'map', id: 'arena', revision: 4 },
      { kind: 'encounter', id: 'arena', revision: 4 },
      { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    ])
    expect(() => buildAuthoritativeItemExecutionContext({
      role: 'gm', command: incomplete, map: map(), mapRevision: 4, persistedSheets: persisted(),
    })).toThrow(AuthoritativeItemExecutionContextError)
  })

  it('loads and revision-checks only an explicitly declared campaign-clock read', () => {
    const withClock = command([
      ...command().readSet,
      { kind: 'campaign-clock', id: 'campaign', revision: 7 },
    ])
    const context = buildAuthoritativeItemExecutionContext({
      role: 'gm', command: withClock, map: map(), mapRevision: 4,
      campaignClock: { revision: 7, campaignMinute: 4_321 }, persistedSheets: persisted(),
    })
    expect(context.campaignClock).toEqual({ revision: 7, campaignMinute: 4_321 })
    expect(Object.isFrozen(context.campaignClock)).toBe(true)
    expect(() => buildAuthoritativeItemExecutionContext({
      role: 'gm', command: withClock, map: map(), mapRevision: 4,
      campaignClock: { revision: 8, campaignMinute: 5_761 }, persistedSheets: persisted(),
    })).toThrow('The campaign clock changed. Refresh before retrying.')
  })

  it('rejects ordinary HP restoration for Fainted, zero-HP, and full-health targets', () => {
    for (const target of [
      { ...pokemon(), combat: { currentHp: 1, conditions: ['Fainted'] } },
      { ...pokemon(), combat: { currentHp: 0 } },
      { ...pokemon(), combat: { currentHp: 27 } },
    ]) {
      const sheets = persisted()
      sheets[1] = { ...sheets[1]!, sheet: target as unknown as Record<string, unknown> }
      const context = buildAuthoritativeItemExecutionContext({
        role: 'gm', command: command(), map: map(), mapRevision: 4, persistedSheets: sheets,
      })
      const result = deriveAuthoritativeItemEligibility(context)
      expect(result.available).toBe(false)
      expect(result.reasons).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'target.invalid' }),
      ]))
    }
  })

  it('projects server-authored X-Item stage previews and rejects cap no-ops before consumption', () => {
    const xTrainer = trainer()
    xTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: 'X Attack', qty: 2 }] }
    const xPersisted = persisted()
    xPersisted[0] = { ...xPersisted[0]!, sheet: xTrainer as unknown as Record<string, unknown> }
    const staged = applyCombatStagesToSheet('pokemon', pokemon(), {
      atk: 5, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0,
    }) as CharacterSheet
    xPersisted[1] = { ...xPersisted[1]!, sheet: staged as unknown as Record<string, unknown> }
    const xCommand = command()
    const context = buildAuthoritativeItemExecutionContext({
      role: 'gm', command: xCommand, map: map(), mapRevision: 4, persistedSheets: xPersisted,
    })
    expect(context.sourceDefinition.definitionSha256)
      .toBe(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('X Attack').definitionSha256)
    const eligible = deriveAuthoritativeItemEligibility(context)
    expect(eligible.available).toBe(true)
    expect(eligible.legalTargets.find(target => target.participantId === 'pikachu-placement')).toMatchObject({
      description: 'Attack +5 → +6 (+1 stage; capped)',
      combatStagePreview: { previous: 5, requestedDelta: 2, appliedDelta: 1, current: 6, capped: true },
    })

    const capped = applyCombatStagesToSheet('pokemon', staged, {
      atk: 6, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0,
    }) as CharacterSheet
    xPersisted[1] = { ...xPersisted[1]!, sheet: capped as unknown as Record<string, unknown> }
    const cappedContext = buildAuthoritativeItemExecutionContext({
      role: 'gm', command: xCommand, map: map(), mapRevision: 4, persistedSheets: xPersisted,
    })
    expect(deriveAuthoritativeItemEligibility(cappedContext)).toMatchObject({
      available: false,
      reasons: expect.arrayContaining([expect.objectContaining({ code: 'target.invalid' })]),
    })
  })

  it('rejects X Items targeting Trainers while keeping reviewed temporary effects encounter-only', () => {
    const xTrainer = trainer()
    xTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: 'Dire Hit', qty: 2 }] }
    const values = persisted()
    values[0] = { ...values[0]!, sheet: xTrainer as unknown as Record<string, unknown> }
    const targetTrainer = command()
    targetTrainer.targetIds = ['ash-placement']
    targetTrainer.choices = [{ choiceId: 'target', optionIds: ['ash-placement'] }]
    const context = buildAuthoritativeItemExecutionContext({
      role: 'gm', command: targetTrainer, map: map(), mapRevision: 4, persistedSheets: values,
    })
    expect(deriveAuthoritativeItemEligibility(context)).toMatchObject({
      available: false,
      reasons: expect.arrayContaining([expect.objectContaining({ code: 'target.invalid' })]),
    })
    expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Dire Hit').spec.contexts).toEqual(['encounter'])
  })

  it('derives Snack storage eligibility from authoritative slots and reviewed previews', () => {
    const snackTrainer = trainer()
    snackTrainer.inventory = { foodStuff: [{ id: 'potion-row', name: 'Leftovers', qty: 1 }] }
    const values = persisted()
    values[0] = { ...values[0]!, sheet: snackTrainer as unknown as Record<string, unknown> }
    const snackCommand = command()
    snackCommand.source.section = 'foodStuff'
    snackCommand.sourceInstanceId = 'item-instance:trainer:ash:foodStuff:potion-row'
    const context = buildAuthoritativeItemExecutionContext({
      role: 'gm', command: snackCommand, map: map(), mapRevision: 4, persistedSheets: values,
    })
    const eligible = deriveAuthoritativeItemEligibility(context)
    expect(eligible.available).toBe(true)
    expect(eligible.legalTargets.find(target => target.participantId === 'pikachu-placement')).toMatchObject({
      participantId: 'pikachu-placement',
      description: 'Stores a Digestion Buff that restores 1/16 maximum HP at each turn start for the rest of the encounter when traded.',
    })
    const occupied = pokemon()
    occupied.items = { digestionFood: 'Candy Bar' }
    values[1] = { ...values[1]!, sheet: occupied as unknown as Record<string, unknown> }
    const blocked = deriveAuthoritativeItemEligibility(buildAuthoritativeItemExecutionContext({
      role: 'gm', command: snackCommand, map: map(), mapRevision: 4, persistedSheets: values,
    }))
    expect(blocked).toMatchObject({
      available: false,
      legalTargets: [expect.objectContaining({ participantId: 'ash-placement' })],
      reasons: expect.arrayContaining([expect.objectContaining({ code: 'target.invalid' })]),
    })
  })

  it('rejects targets under an authoritative healing-prevention effect', () => {
    const blocked = map()
    blocked.encounterState = {
      ...blocked.encounterState!,
      effects: [{
        id: 'effect.healing-blocked', kind: 'capability',
        source: { operationId: 'op.cruelty', moveId: 'ability.cruelty', placementId: 'ash-placement' },
        affected: { placementIds: ['pikachu-placement'], sideIds: [], cells: [] },
        createdRound: 1, createdTurn: 0,
        duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
        stacks: 1, charges: null,
        stackPolicy: { kind: 'replace', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null },
        tags: ['ability', 'healing-blocked'],
        payload: { capabilityId: CRUELTY_HEALING_BLOCK_CAPABILITY_ID, action: 'grant' },
        dispel: { policy: 'none', tags: [] }, transferPolicy: 'retain', suppression: { sources: [] },
      }],
    }
    const context = buildAuthoritativeItemExecutionContext({
      role: 'gm', command: command(), map: blocked, mapRevision: 4, persistedSheets: persisted(),
    })
    const result = deriveAuthoritativeItemEligibility(context)
    expect(result.available).toBe(false)
    expect(result.legalTargets).toEqual([])
  })

  it('fails item-tool offers closed on authoritative skill-rank and Feature prerequisites', () => {
    const definition = structuredClone(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Potion'))
    definition.spec.prerequisites = [
      {
        prerequisiteId: 'medicine-rank', kind: 'skill-rank', values: ['medicineEd', '4'],
        unavailableReason: 'Adept Medicine Education is required.',
      },
      {
        prerequisiteId: 'required-feature', kind: 'feature', values: ['First Aid Expertise'],
        unavailableReason: 'First Aid Expertise is required.',
      },
    ]
    const actor = trainer()
    actor.skillBackground = { adept: 'medicineEd' }
    actor.features = [{ name: 'First Aid Expertise' }]
    const actorPlacement = map().placements.find(placement => placement.id === 'ash-placement')!
    const projected = (sheet: TrainerSheet) => projectEncounterItemEligibility({
      definition,
      map: map(),
      actorPlacement,
      actor: {
        participantId: 'ash-placement', displayName: 'Ash', portraitUrl: null,
        sideId: 'heroes', sideLabel: 'Heroes', sideAccent: null,
        sheetKind: 'trainer', statusLabels: [],
      },
      actorSheet: sheet,
      sourceQuantity: 1,
      pokemonSheets: [pokemon()],
      trainerSheets: [sheet],
    })
    expect(projected(actor).available).toBe(true)
    expect(projected({ ...actor, features: [] })).toMatchObject({
      available: false,
      reasons: expect.arrayContaining([expect.objectContaining({
        code: 'source.capability-required', label: 'First Aid Expertise is required.',
      })]),
    })
    expect(projected({ ...actor, skillBackground: undefined })).toMatchObject({
      available: false,
      reasons: expect.arrayContaining([expect.objectContaining({
        code: 'source.capability-required', label: 'Adept Medicine Education is required.',
      })]),
    })
  })

  it('rejects item actions by a Fainted actor even when a legal target exists', () => {
    const actorFainted = persisted()
    actorFainted[0] = {
      ...actorFainted[0]!,
      sheet: { ...trainer(), currentHp: 0, conditions: ['Fainted'] } as unknown as Record<string, unknown>,
    }
    const context = buildAuthoritativeItemExecutionContext({
      role: 'gm', command: command(), map: map(), mapRevision: 4, persistedSheets: actorFainted,
    })
    expect(deriveAuthoritativeItemEligibility(context)).toMatchObject({
      available: false,
      reasons: expect.arrayContaining([expect.objectContaining({ code: 'condition.fainted' })]),
    })
  })

  it('fails selected targets closed when target prerequisites or action economy changed', () => {
    const spent = map()
    const ledger = spent.encounterState!.turnResources['ash-placement']!
    spent.encounterState = {
      ...spent.encounterState!,
      turnResources: {
        'ash-placement': {
          ...ledger,
          actions: { ...ledger.actions, standard: { ...ledger.actions.standard, spent: 1 } },
        },
      },
    }
    const context = buildAuthoritativeItemExecutionContext({
      role: 'gm', command: command(), map: spent, mapRevision: 4, persistedSheets: persisted(),
    })
    expect(deriveAuthoritativeItemEligibility(context)).toMatchObject({
      available: false,
      reasons: [expect.objectContaining({ code: 'economy.standard-spent' })],
    })
  })

  it('builds a map-free sheet context with exact campaign clock and roster ownership evidence', () => {
    const targetId = sheetItemTargetId('pokemon', 'pikachu')
    const nonEncounterCommand: UseItemCommandV1 = {
      ...command(),
      context: 'sheet',
      actorParticipantId: null,
      targetIds: [targetId],
      choices: [{ choiceId: 'target', optionIds: [targetId] }],
      readSet: [
        { kind: 'campaign-clock', id: 'campaign', revision: 7 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
        { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
      ],
    }
    const context = buildAuthoritativeItemExecutionContext({
      role: 'gm', command: nonEncounterCommand, map: null, mapRevision: null,
      campaignClock: { revision: 7, campaignMinute: 4_321 },
      authorityTimestamp: 100, persistedSheets: persisted(),
    })
    expect(context.map).toBeNull()
    expect(context.nonEncounter).toMatchObject({
      context: 'sheet',
      campaignTime: { clockRevision: 7, campaignMinute: 4_321 },
      actor: { sheetKind: 'trainer', sheetSlug: 'ash', sheetRevision: 3 },
      extendedAction: { mode: 'immediate', phase: 'completion' },
      gmConfirmation: { required: false, status: 'not-required' },
    })
    expect(context.nonEncounter?.targetAuthorities).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId, ownerTrainerSlug: 'ash', authority: 'actor-roster' }),
      expect.objectContaining({ authority: 'actor', sheetKind: 'trainer', sheetSlug: 'ash' }),
    ]))
    expect(deriveAuthoritativeItemEligibility(context).available).toBe(true)
  })

  it('rejects an unowned non-encounter target for a player while recording a GM override', () => {
    const eevee = { ...pokemon(), slug: 'eevee', nickname: 'Eevee', species: 'Eevee' }
    const sheets: PersistedSheet[] = [persisted()[0]!, {
      kind: 'pokemon', slug: 'eevee', revision: 2, updatedAt: 10,
      sheet: eevee as unknown as Record<string, unknown>,
    }]
    const targetId = sheetItemTargetId('pokemon', 'eevee')
    const nonEncounterCommand: UseItemCommandV1 = {
      ...command(), context: 'campaign', actorParticipantId: null,
      targetIds: [targetId], choices: [{ choiceId: 'target', optionIds: [targetId] }],
      readSet: [
        { kind: 'campaign-clock', id: 'campaign', revision: 7 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
        { kind: 'sheet', sheetKind: 'pokemon', id: 'eevee', revision: 2 },
      ],
    }
    const profile = normalizePlayerProfile({
      schemaVersion: 1,
      id: 'profile_ashplayer',
      displayName: 'Ash Player',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
    })
    expect(() => buildAuthoritativeItemExecutionContext({
      role: 'player', playerProfile: profile, command: nonEncounterCommand,
      map: null, mapRevision: null, campaignClock: { revision: 7, campaignMinute: 4_321 },
      authorityTimestamp: 100, persistedSheets: sheets,
    })).toThrow('not owned or controlled')

    const gmContext = buildAuthoritativeItemExecutionContext({
      role: 'gm', command: nonEncounterCommand, map: null, mapRevision: null,
      campaignClock: { revision: 7, campaignMinute: 4_321 }, authorityTimestamp: 100,
      persistedSheets: sheets,
    })
    expect(gmContext.nonEncounter?.targetAuthorities).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId, ownerTrainerSlug: null, authority: 'gm-override' }),
    ]))
  })

  it('keeps Extended Action mechanics non-executable until exact durable completion authority exists', () => {
    const values = persisted()
    values[0] = {
      ...values[0]!,
      sheet: {
        ...trainer(),
        inventory: { medicalKit: [{ id: 'first-aid-row', name: 'First Aid Kit', qty: 1 }] },
      } as unknown as Record<string, unknown>,
    }
    const targetId = sheetItemTargetId('pokemon', 'pikachu')
    const firstAidCommand: UseItemCommandV1 = {
      ...command(), context: 'campaign', operationId: 'op_item_first_aid_context',
      actorParticipantId: null,
      sourceInstanceId: 'item-instance:trainer:ash:medicalKit:first-aid-row',
      source: {
        kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'first-aid-row', expectedRevision: 3,
      },
      targetIds: [targetId], choices: [{ choiceId: 'target', optionIds: [targetId] }],
      readSet: [
        { kind: 'campaign-clock', id: 'campaign', revision: 7 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
        { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
      ],
    }
    const build = (extendedAction?: BuildAuthoritativeItemExecutionContextInput['extendedAction']) => (
      buildAuthoritativeItemExecutionContext({
        role: 'gm', command: firstAidCommand, map: null, mapRevision: null,
        campaignClock: { revision: 7, campaignMinute: 4_321 }, authorityTimestamp: 100,
        persistedSheets: values, ...(extendedAction ? { extendedAction } : {}),
      })
    )
    const declaration = build()
    expect(declaration.nonEncounter?.extendedAction).toMatchObject({ mode: 'extended', phase: 'declaration' })
    expect(deriveAuthoritativeItemEligibility(declaration)).toMatchObject({
      available: false,
      reasons: expect.arrayContaining([expect.objectContaining({
        code: 'action.parameters-required', label: 'Start this Extended Action before resolving the item.',
      })]),
    })
    const completion = build({
      phase: 'completion', activityId: 'item-activity:v1:first-aid-context',
      activityRevision: 1, startedAtCampaignMinute: 4_321,
    })
    expect(completion.nonEncounter?.extendedAction).toMatchObject({
      mode: 'extended', phase: 'completion', activityRevision: 1,
    })
    expect(deriveAuthoritativeItemEligibility(completion).available).toBe(true)
  })
})
