import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import authorityJson from '../fixtures/breeding/egg-production-authority-v1.json'
import eggContractJson from '../../data/breeding-automation/egg-contract.json'
import hatchDurationPolicyJson from '../../data/breeding-automation/hatch-duration-policy.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import type { PlayerProfile } from '../../shared/playerProfiles'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import {
  PokemonEggHatchOfferValidationError,
  parsePokemonEggHatchOfferProjectionV1,
} from '../../shared/breeding/hatchOffers'
import {
  createBreedingActorAuthorityV1,
  createBreedingTrainerControlEvidenceV1,
} from '../../server/domain/breeding/authorization'
import { validatePokemonEggRevisionSuccessor } from '../../server/domain/breeding/eggLifecycle'
import {
  PokemonEggHatchOfferAuthorityError,
  assertPokemonEggHatchOfferAuthorityExactReplayV1,
  consumePokemonEggHatchOfferV1,
  createPokemonEggHatchOwnerTrainerFactV1,
  projectPokemonEggHatchOfferProjectionV1,
  projectPokemonEggHatchOfferV1,
} from '../../server/domain/breeding/hatchOffers'
import { createPokemonEggOffspringBlueprintV1, parseAuthoritativePokemonEggDocumentV1 } from '../../server/domain/breeding/lineage'
import { createBreedingOperationAcceptedV1, createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import { compiledBreedingSpeciesSpec } from '../../server/domain/breeding/registry'
import { openRotomDatabase } from '../../server/storage/database'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqlitePokemonEggRepository } from '../../server/storage/pokemonEggRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import {
  consumeCurrentPokemonEggHatchOffer,
  projectCurrentPokemonEggHatchOffer,
  projectCurrentPokemonEggHatchOfferProjection,
  ProjectPokemonEggHatchOfferError,
} from '../../server/useCases/projectPokemonEggHatchOffer'

const fixture = authorityJson as any
const references = fixture.readSet.referenceVersions
const ruleset = Object.freeze({ rulesetId: references.rulesetId, definitionSha256: references.rulesetDefinitionSha256 })
const EGG_ID = 'pokemon-egg:v1:54545454545454545454545454545454'
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const sha256 = (value: unknown): string => createHash('sha256').update(
  typeof value === 'string' ? value : stableJsonStringify(value),
).digest('hex')
const profile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_owner_0001' as any,
  displayName: 'Owner' as any,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
}
const trainerDocument = (teamCount = 2): Record<string, unknown> => ({
  slug: 'trainer-owner',
  name: 'Owner',
  currentTeam: Array.from({ length: teamCount }, (_, index) => `pokemon-team-${index}`),
  boxedPokemon: ['pokemon-boxed-0'],
})
const sourceCommand = () => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(1),
  commandKind: 'create-source-egg',
  actor: { profileId: 'gm-principal', selectedTrainerSlug: null },
  ruleset,
  scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: null }],
  payload: {
    eggId: EGG_ID,
    ownerTrainerSlug: 'trainer-owner',
    source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: 'e'.repeat(64) },
    speciesOptionId: 'option:v1:54545454545454545454545454545454',
    resolutions: { selectedOptionIds: [], requestedRollKinds: [] },
  },
})
const markCommand = () => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(2),
  commandKind: 'mark-egg-ready',
  actor: { profileId: 'gm-principal', selectedTrainerSlug: null },
  ruleset,
  scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: 0 }],
  payload: { eggId: EGG_ID, reasonId: 'breeding.egg-ready.gm-adjudication' },
})
const initialEgg = () => {
  const species = compiledBreedingSpeciesSpec('bulbasaur')!
  const blueprint = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1,
    speciesId: species.speciesId,
    familyRootSpeciesId: species.familyRootSpeciesId,
    speciesSpecDefinitionSha256: species.definitionSha256,
    nature: { valueId: 'cuddly', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    ability: { valueId: species.basicAbilityIds[0]!, resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    gender: { valueId: 'female', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    inheritanceCandidates: [],
    startingLevel: 1,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
  })
  const durationResultDefinitionSha256 = 'd'.repeat(64)
  return parseAuthoritativePokemonEggDocumentV1({
    schemaVersion: 1,
    eggId: EGG_ID,
    revision: 0,
    status: 'incubating',
    ownerTrainerSlug: 'trainer-owner',
    source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: 'e'.repeat(64) },
    ruleset,
    definitionHashes: [
      blueprint.definitionSha256,
      durationResultDefinitionSha256,
      eggContractJson.definitionSha256,
      hatchDurationPolicyJson.definitionSha256,
      ruleset.definitionSha256,
    ].sort(),
    parents: [],
    breeder: null,
    offspring: blueprint,
    incubation: {
      averageCampaignMinutes: 600,
      targetCampaignMinutes: 600,
      accumulatedCampaignMinutes: 0,
      variationPolicyId: 'fixed-average',
      durationResultDefinitionSha256,
      lastAppliedClockRevision: 1,
      lastAppliedClockMinute: 100,
      readyAtCampaignMinute: null,
      readinessKind: null,
      readyOperationId: null,
      paused: false,
      pauseReasonId: null,
      pauseOperationId: null,
    },
    special: { state: 'not-rolled', rollRecordId: null, rollTotal: null, triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false },
    hatchOperationId: null,
    childSheetSlug: null,
    terminal: null,
    createdAtCampaignMinute: 100,
    updatedAtCampaignMinute: 100,
    statusChangedAtCampaignMinute: 100,
    lastOperationId: operationId(1),
  })
}
const readyEgg = () => {
  const current = initialEgg()
  return validatePokemonEggRevisionSuccessor(current, {
    ...current,
    revision: 1,
    status: 'ready',
    incubation: {
      ...current.incubation,
      readyAtCampaignMinute: 700,
      readinessKind: 'gm-mark-ready',
      readyOperationId: operationId(2),
    },
    updatedAtCampaignMinute: 700,
    statusChangedAtCampaignMinute: 700,
    lastOperationId: operationId(2),
  })
}
const cancelledEgg = () => {
  const current = initialEgg()
  return validatePokemonEggRevisionSuccessor(current, {
    ...current,
    revision: 1,
    status: 'cancelled',
    terminal: { reasonId: 'breeding.egg-terminal.cancelled', atCampaignMinute: 700, operationId: operationId(3) },
    updatedAtCampaignMinute: 700,
    statusChangedAtCampaignMinute: 700,
    lastOperationId: operationId(3),
  })
}
const beginCommand = (input: {
  readonly operation?: number
  readonly egg?: ReturnType<typeof readyEgg>
  readonly destination?: 'box' | 'team'
  readonly role?: 'owner' | 'gm'
  readonly destinationTrainerSlug?: string
}) => {
  const current = input.egg ?? readyEgg()
  return parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: operationId(input.operation ?? 10),
    commandKind: 'begin-hatch',
    actor: input.role === 'gm'
      ? { profileId: 'gm-principal', selectedTrainerSlug: null }
      : { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' },
    ruleset,
    scopes: [{ kind: 'pokemon-egg', eggId: current.eggId, expectedRevision: current.revision }],
    payload: {
      eggId: current.eggId,
      destination: { kind: input.destination ?? 'box', trainerSheetSlug: input.destinationTrainerSlug ?? 'trainer-owner' },
      requestSpecialRoll: true,
    },
  })
}
const context = (input: {
  readonly command: ReturnType<typeof beginCommand>
  readonly egg?: ReturnType<typeof readyEgg>
  readonly teamCount?: number
  readonly role?: 'owner' | 'gm'
  readonly atCampaignMinute?: number
}) => {
  const atCampaignMinute = input.atCampaignMinute ?? 700
  const document = trainerDocument(input.teamCount)
  const fact = createPokemonEggHatchOwnerTrainerFactV1({
    trainerSheetSlug: 'trainer-owner', trainerSheetRevision: 3, trainerSheetDocument: document,
  })
  const actor = createBreedingActorAuthorityV1({
    role: input.role === 'gm' ? 'gm' : 'player',
    command: input.command,
    authenticatedPrincipalSha256: 'a'.repeat(64),
    authenticationPolicyDefinitionSha256: 'b'.repeat(64),
    profile: input.role === 'gm' ? null : profile,
    evaluatedAtCampaignMinute: atCampaignMinute,
  })
  const control = input.role === 'gm' ? null : createBreedingTrainerControlEvidenceV1({
    profile,
    trainerSheetSlug: 'trainer-owner',
    trainerSheetRevision: 3,
    trainerSheetDefinitionSha256: sha256(document),
    evaluatedAtCampaignMinute: atCampaignMinute,
  })
  return {
    command: input.command,
    egg: input.egg ?? readyEgg(),
    ownerTrainerFact: fact,
    actorAuthority: actor,
    ownerTrainerControl: control,
    referenceVersions: references,
    atCampaignMinute,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  }
}
const declaration = (authority: ReturnType<typeof projectPokemonEggHatchOfferV1>) => ({
  schemaVersion: 1,
  offerId: authority.offer.offerId,
  offerDefinitionSha256: authority.offer.offerDefinitionSha256,
  operationId: authority.commandOperationId,
})

const seed = (teamCount = 2) => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  const source = sourceCommand()
  const mark = markCommand()
  const initial = initialEgg()
  const ready = readyEgg()
  const trainer = trainerDocument(teamCount)
  database.withTransaction(() => {
    const operations = createSqliteBreedingOperationRepository(database)
    const eggs = createSqlitePokemonEggRepository(database)
    operations.reserve(source, 100)
    eggs.insert(initial)
    operations.settle(source, createBreedingOperationAcceptedV1({
      operationId: source.operationId,
      commandHash: createBreedingOperationCommandHash(source),
      commandKind: source.commandKind,
      outcomeKind: 'source-egg-created',
      aggregateRefs: [{ kind: 'pokemon-egg', id: EGG_ID, revision: 0 }],
      changedScopes: source.scopes,
      committedAtCampaignMinute: 100,
    }), 100)
    operations.reserve(mark, 700)
    eggs.replace({ expectedRevision: 0, document: ready })
    operations.settle(mark, createBreedingOperationAcceptedV1({
      operationId: mark.operationId,
      commandHash: createBreedingOperationCommandHash(mark),
      commandKind: mark.commandKind,
      outcomeKind: 'egg-ready',
      aggregateRefs: [{ kind: 'pokemon-egg', id: EGG_ID, revision: 1 }],
      changedScopes: mark.scopes,
      committedAtCampaignMinute: 700,
    }), 700)
    database.connection.prepare(`
      INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
      VALUES ('trainer', 'trainer-owner', ?, 3, 700)
    `).run(stableJsonStringify(trainer))
    database.connection.prepare(`
      UPDATE campaign_clock
      SET revision = 2, campaign_minute = 700, last_operation_id = ?
      WHERE singleton = 1
    `).run(mark.operationId)
  })
  const storedTrainer = createSqliteSheetRepository(database).get('trainer', 'trainer-owner')!
  return { database, trainer: storedTrainer.document as Record<string, unknown> }
}

describe('BR-054 authorized Pokémon Egg hatch offers', () => {
  it('projects and consumes one exact owner box offer with bounded destination choices', () => {
    const command = beginCommand({ destination: 'box' })
    const input = context({ command })
    const authority = projectPokemonEggHatchOfferV1(input)
    expect(authority.offer).toMatchObject({
      audience: 'owner',
      actionId: 'breeding.egg.begin-hatch',
      availability: { status: 'available', reasonId: null },
      issuedAtCampaignMinute: 700,
      expiresAtCampaignMinute: 701,
    })
    expect(authority.destinations.map(option => ({ kind: option.kind, availability: option.availability, slots: option.remainingTeamSlots }))).toEqual([
      { kind: 'box', availability: { status: 'available', reasonId: null }, slots: null },
      { kind: 'team', availability: { status: 'available', reasonId: null }, slots: 4 },
    ])
    const consumed = consumePokemonEggHatchOfferV1({ ...input, declaration: declaration(authority) })
    expect(consumed.selectedDestination.kind).toBe('box')
    expect(assertPokemonEggHatchOfferAuthorityExactReplayV1(authority, structuredClone(authority))).toEqual(authority)
  })

  it('projects a privacy-bounded owner/GM offer view without authority internals or roster identities', () => {
    const command = beginCommand({ destination: 'team' })
    const authority = projectPokemonEggHatchOfferV1(context({ command }))
    const projection = projectPokemonEggHatchOfferProjectionV1({ authority, egg: readyEgg() })
    expect(projection).toMatchObject({ audience: 'owner', eggStatus: 'ready', canSubmit: true, blockerReasonIds: [] })
    const text = JSON.stringify(projection)
    expect(text).not.toMatch(/pokemon-team|pokemon-boxed|species|nature|abilityId|gender|parent|breeder|profile|consent|readSet|receipt|ownerTrainerFact|actorAuthority/iu)
    expect(() => parsePokemonEggHatchOfferProjectionV1({ ...projection, eggStatus: 'incubating' })).toThrow(PokemonEggHatchOfferValidationError)
    expect(() => parsePokemonEggHatchOfferProjectionV1({ ...projection, canSubmit: false })).toThrow(PokemonEggHatchOfferValidationError)
    expect(() => projectPokemonEggHatchOfferProjectionV1({ authority, egg: initialEgg() })).toThrow(PokemonEggHatchOfferAuthorityError)
  })

  it('offers team only with an open slot and leaves box available when the team is full', () => {
    const teamCommand = beginCommand({ destination: 'team' })
    const teamAvailable = projectPokemonEggHatchOfferV1(context({ command: teamCommand, teamCount: 5 }))
    expect(teamAvailable.offer.availability.status).toBe('available')
    expect(teamAvailable.destinations[1].remainingTeamSlots).toBe(1)

    const teamFull = projectPokemonEggHatchOfferV1(context({ command: teamCommand, teamCount: 6 }))
    expect(teamFull.offer.availability).toEqual({ status: 'unavailable', reasonId: 'breeding.hatch-offer.team-full' })
    expect(teamFull.blockerReasonIds).toEqual(['breeding.hatch-offer.team-full'])
    expect(() => consumePokemonEggHatchOfferV1({ ...context({ command: teamCommand, teamCount: 6 }), declaration: declaration(teamFull) })).toThrow(PokemonEggHatchOfferAuthorityError)

    const boxCommand = beginCommand({ destination: 'box', operation: 11 })
    const box = projectPokemonEggHatchOfferV1(context({ command: boxCommand, teamCount: 6 }))
    expect(box.offer.availability.status).toBe('available')
    expect(box.destinations[1].availability.reasonId).toBe('breeding.hatch-offer.team-full')
  })

  it('projects closed lifecycle blockers before destination capacity and never treats source continuity as a blocker', () => {
    const notReady = initialEgg()
    const notReadyCommand = beginCommand({ egg: notReady as any, destination: 'team', operation: 12 })
    const blocked = projectPokemonEggHatchOfferV1(context({ command: notReadyCommand, egg: notReady as any, teamCount: 6 }))
    expect(blocked.blockerReasonIds).toEqual(['breeding.egg-lifecycle.not-ready'])
    expect(blocked.destinations.every(option => option.availability.reasonId === 'breeding.egg-lifecycle.not-ready')).toBe(true)

    const cancelled = cancelledEgg()
    const cancelledCommand = beginCommand({ egg: cancelled as any, destination: 'box', operation: 13 })
    expect(projectPokemonEggHatchOfferV1(context({ command: cancelledCommand, egg: cancelled as any }))).toMatchObject({
      blockerReasonIds: ['breeding.egg-lifecycle.cancelled'],
    })
  })

  it('requires exact current owner control or current GM campaign authority', () => {
    const ownerCommand = beginCommand({ destination: 'box' })
    const ownerInput = context({ command: ownerCommand })
    expect(() => projectPokemonEggHatchOfferV1({ ...ownerInput, ownerTrainerControl: null })).toThrow(PokemonEggHatchOfferAuthorityError)

    const gmCommand = beginCommand({ destination: 'box', operation: 14, role: 'gm' })
    const gmInput = context({ command: gmCommand, role: 'gm' })
    const gm = projectPokemonEggHatchOfferV1(gmInput)
    expect(gm.offer).toMatchObject({ audience: 'gm', actor: { kind: 'campaign', resourceId: 'campaign', revision: null } })
    expect(() => projectPokemonEggHatchOfferV1({ ...gmInput, ownerTrainerControl: ownerInput.ownerTrainerControl })).toThrow(PokemonEggHatchOfferAuthorityError)
  })

  it('rejects stale Egg/ruleset/actor and foreign owner destinations before projecting choices', () => {
    const current = readyEgg()
    const command = beginCommand({ egg: current, destination: 'box' })
    const input = context({ command, egg: current })
    expect(() => projectPokemonEggHatchOfferV1({ ...input, egg: { ...current, revision: 2 } })).toThrow()
    expect(() => projectPokemonEggHatchOfferV1({ ...input, command: { ...command, ruleset: { ...ruleset, definitionSha256: 'f'.repeat(64) } } })).toThrow(PokemonEggHatchOfferAuthorityError)
    expect(() => projectPokemonEggHatchOfferV1({ ...input, command: { ...command, actor: { ...command.actor, profileId: 'profile-other' } } })).toThrow(PokemonEggHatchOfferAuthorityError)
    expect(() => projectPokemonEggHatchOfferV1({
      ...input,
      command: { ...command, scopes: [...command.scopes, { kind: 'trainer-sheet', sheetSlug: 'trainer-owner', expectedRevision: 3, fields: ['roster'] }] },
    })).toThrow(PokemonEggHatchOfferAuthorityError)
    const foreign = beginCommand({ egg: current, destinationTrainerSlug: 'trainer-other', operation: 15 })
    expect(() => projectPokemonEggHatchOfferV1(context({ command: foreign, egg: current }))).toThrow(PokemonEggHatchOfferAuthorityError)
  })

  it('rejects expired, mismatched, tampered, and enriched declarations or authority', () => {
    const command = beginCommand({ destination: 'box' })
    const input = context({ command })
    const authority = projectPokemonEggHatchOfferV1(input)
    expect(() => consumePokemonEggHatchOfferV1({
      ...input,
      declaration: { ...declaration(authority), offerDefinitionSha256: 'f'.repeat(64) },
    })).toThrow(PokemonEggHatchOfferAuthorityError)
    const nextMinuteInput = context({ command, atCampaignMinute: 701 })
    expect(() => consumePokemonEggHatchOfferV1({ ...nextMinuteInput, declaration: declaration(authority) })).toThrow(PokemonEggHatchOfferAuthorityError)
    expect(() => assertPokemonEggHatchOfferAuthorityExactReplayV1(authority, {
      ...authority,
      commandSha256: 'f'.repeat(64),
    })).toThrow(PokemonEggHatchOfferAuthorityError)
    expect(() => projectPokemonEggHatchOfferV1({ ...input, clientChoice: 'team' } as any)).toThrow(PokemonEggHatchOfferAuthorityError)
    expect(() => parsePokemonEggHatchOfferProjectionV1({
      ...projectPokemonEggHatchOfferProjectionV1({ authority, egg: readyEgg() }),
      privateRoster: ['pokemon-hidden'],
    })).toThrow(PokemonEggHatchOfferValidationError)
  })

  it('builds owner destination facts only from strict bounded non-ambiguous Trainer rosters', () => {
    expect(createPokemonEggHatchOwnerTrainerFactV1({
      trainerSheetSlug: 'trainer-owner', trainerSheetRevision: 3, trainerSheetDocument: trainerDocument(6),
    })).toMatchObject({ currentTeamCount: 6, boxedPokemonCount: 1, remainingTeamSlots: 0 })
    expect(() => createPokemonEggHatchOwnerTrainerFactV1({
      trainerSheetSlug: 'trainer-owner', trainerSheetRevision: 3,
      trainerSheetDocument: { ...trainerDocument(), currentTeam: ['pokemon-a'], boxedPokemon: ['pokemon-a'] },
    })).toThrow(PokemonEggHatchOfferAuthorityError)
    expect(() => createPokemonEggHatchOwnerTrainerFactV1({
      trainerSheetSlug: 'trainer-owner', trainerSheetRevision: 3,
      trainerSheetDocument: { ...trainerDocument(), currentTeam: ['pokemon-a', 'pokemon-a'] },
    })).toThrow(PokemonEggHatchOfferAuthorityError)
    const document = trainerDocument()
    Object.defineProperty(document, 'currentTeam', { enumerable: true, get: () => [] })
    expect(() => createPokemonEggHatchOwnerTrainerFactV1({
      trainerSheetSlug: 'trainer-owner', trainerSheetRevision: 3, trainerSheetDocument: document,
    })).toThrow(PokemonEggHatchOfferAuthorityError)
    let accessorRead = false
    const accessorInput = {
      trainerSheetRevision: 3,
      trainerSheetDocument: trainerDocument(),
    } as Record<string, unknown>
    Object.defineProperty(accessorInput, 'trainerSheetSlug', {
      enumerable: true,
      get: () => { accessorRead = true; return 'trainer-owner' },
    })
    expect(() => createPokemonEggHatchOwnerTrainerFactV1(accessorInput as any)).toThrow(PokemonEggHatchOfferAuthorityError)
    expect(accessorRead).toBe(false)
  })

  it('projects and consumes current storage-bound owner offers with byte-equivalent retry', () => {
    const seeded = seed(2)
    try {
      const command = beginCommand({ destination: 'team', operation: 20 })
      const fact = createPokemonEggHatchOwnerTrainerFactV1({
        trainerSheetSlug: 'trainer-owner', trainerSheetRevision: 3, trainerSheetDocument: seeded.trainer,
      })
      const actor = createBreedingActorAuthorityV1({
        role: 'player', command, authenticatedPrincipalSha256: 'a'.repeat(64), authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile, evaluatedAtCampaignMinute: 700,
      })
      const control = createBreedingTrainerControlEvidenceV1({
        profile, trainerSheetSlug: 'trainer-owner', trainerSheetRevision: 3,
        trainerSheetDefinitionSha256: fact.trainerSheetDefinitionSha256, evaluatedAtCampaignMinute: 700,
      })
      const input = { command, actorAuthority: actor, ownerTrainerControl: control, referenceVersions: references }
      const options = { database: seeded.database, resolveCurrentReferenceVersions: () => references }
      const first = projectCurrentPokemonEggHatchOffer(input, options)
      const retry = projectCurrentPokemonEggHatchOffer(input, options)
      expect(stableJsonStringify(retry)).toBe(stableJsonStringify(first))
      expect(projectCurrentPokemonEggHatchOfferProjection(input, options)).toMatchObject({ audience: 'owner', canSubmit: true })
      expect(consumeCurrentPokemonEggHatchOffer({ ...input, declaration: declaration(first) }, options).selectedDestination.kind).toBe('team')
    }
    finally { seeded.database.close() }
  })

  it('fails current projection closed on GM verifier faults, reference drift, expiry equality, and Trainer revision drift', () => {
    const seeded = seed(2)
    try {
      const gmCommand = beginCommand({ destination: 'box', operation: 21, role: 'gm' })
      const gmActor = createBreedingActorAuthorityV1({
        role: 'gm', command: gmCommand, authenticatedPrincipalSha256: 'a'.repeat(64), authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile: null, evaluatedAtCampaignMinute: 700,
      })
      const gmInput = { command: gmCommand, actorAuthority: gmActor, ownerTrainerControl: null, referenceVersions: references }
      expect(() => projectCurrentPokemonEggHatchOffer(gmInput, {
        database: seeded.database, resolveCurrentReferenceVersions: () => references, validateCurrentGmAuthority: () => false,
      })).toThrow(ProjectPokemonEggHatchOfferError)
      expect(() => projectCurrentPokemonEggHatchOffer(gmInput, {
        database: seeded.database, resolveCurrentReferenceVersions: () => Promise.resolve(references) as any, validateCurrentGmAuthority: () => true,
      })).toThrow(ProjectPokemonEggHatchOfferError)
      const options = { database: seeded.database, resolveCurrentReferenceVersions: () => references, validateCurrentGmAuthority: () => true }
      const authority = projectCurrentPokemonEggHatchOffer(gmInput, options)
      seeded.database.connection.prepare('UPDATE campaign_clock SET revision = 3, campaign_minute = 701 WHERE singleton = 1').run()
      const gmActor701 = createBreedingActorAuthorityV1({
        role: 'gm', command: gmCommand, authenticatedPrincipalSha256: 'a'.repeat(64), authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile: null, evaluatedAtCampaignMinute: 701,
      })
      expect(() => consumeCurrentPokemonEggHatchOffer({
        ...gmInput, actorAuthority: gmActor701, declaration: declaration(authority),
      }, options)).toThrow(PokemonEggHatchOfferAuthorityError)

      seeded.database.connection.prepare('UPDATE campaign_clock SET revision = 2, campaign_minute = 700 WHERE singleton = 1').run()
      const changedTrainer = { ...seeded.trainer, currentTeam: [...seeded.trainer.currentTeam as string[], 'pokemon-new'] }
      seeded.database.connection.prepare('UPDATE sheets SET document_json = ?, revision = 4 WHERE kind = ? AND slug = ?')
        .run(stableJsonStringify(changedTrainer), 'trainer', 'trainer-owner')
      const ownerCommand = beginCommand({ destination: 'box', operation: 22 })
      const ownerActor = createBreedingActorAuthorityV1({
        role: 'player', command: ownerCommand, authenticatedPrincipalSha256: 'a'.repeat(64), authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile, evaluatedAtCampaignMinute: 700,
      })
      const staleControl = createBreedingTrainerControlEvidenceV1({
        profile, trainerSheetSlug: 'trainer-owner', trainerSheetRevision: 3,
        trainerSheetDefinitionSha256: sha256(seeded.trainer), evaluatedAtCampaignMinute: 700,
      })
      expect(() => projectCurrentPokemonEggHatchOffer({
        command: ownerCommand, actorAuthority: ownerActor, ownerTrainerControl: staleControl, referenceVersions: references,
      }, { database: seeded.database, resolveCurrentReferenceVersions: () => references })).toThrow(PokemonEggHatchOfferAuthorityError)
    }
    finally { seeded.database.close() }
  })
})
