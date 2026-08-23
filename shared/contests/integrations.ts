import movesJson from '../../data/reference/moves.json'
import { resolvedSheetFeatureClosure, sheetHasCanonicalFeature, type FeatureSheetLike } from '../featureAutomation/sheetFeatures'
import { resolvedSheetEdgeInstances, sheetHasCanonicalEdge } from '../edgeAutomation/sheetEdges'
import type { SheetEquipmentStateV1 } from '../itemAutomation/equipment'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { TrainerMove, TrainerSheet } from '~/types/trainerSheet'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { derivePokemonContestPreparation, type PokemonContestPreparationProjectionV1 } from './preparation'
import { emptyContestStatRecord, isContestEffectId, isContestStatId, type ContestStatId } from './ids'
import { emptyContestDicePools, type ContestDicePoolV1, type ContestMoveOptionV1, type ContestPokemonPerformerSnapshotV1, type ContestTrainerPerformerSnapshotV1 } from './document'
import { capabilityWeaponMove } from '../capabilityAutomation/weaponMoves'

interface MoveReferenceRow {
  readonly name: string
  readonly range?: string
  readonly contest?: { readonly schemaVersion: 1, readonly status: 'defined', readonly typeId: string, readonly effectId: string, readonly tags?: readonly string[] }
    | { readonly schemaVersion: 1, readonly status: 'unavailable', readonly reasonCode?: string, readonly safeReason?: string }
}
const moveRows = movesJson as Record<string, MoveReferenceRow>
const normalized = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').trim().toLowerCase().replace(/[^a-z0-9]+/gu, '')
const moveByIdentity = new Map(Object.entries(moveRows).flatMap(([id, row]) => [[normalized(id), { id, row }], [normalized(row.name), { id, row }]]))
const optionSlug = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 100) || 'move'

export interface ContestTrainerIntegrationsV1 {
  readonly providerIds: readonly string[]
  readonly hasGrace: boolean
  readonly hasGroomer: boolean
  readonly hasCoordinator: boolean
  readonly hasReliablePerformance: boolean
  readonly hasStyleFlourish: boolean
  readonly styleFlourishStatIds: readonly ContestStatId[]
  readonly hasJugglingShow: boolean
  readonly voiceLessons: boolean
  readonly styleExpertStatIds: readonly ContestStatId[]
  readonly alignmentInterventionIds: readonly string[]
  readonly acrobaticsHalfRankDice: number
  readonly fancyClothesStatIds: readonly ContestStatId[]
}
const contestStatChoiceValues = (sheet: FeatureSheetLike, canonicalId: string): readonly ContestStatId[] => Object.freeze([...new Set(resolvedSheetFeatureClosure(sheet)
  .filter(instance => instance.canonicalId === canonicalId)
  .flatMap(instance => instance.choices.filter(choice => choice.choiceId === 'contestStat').flatMap(choice => choice.values))
  .map(value => value.toLowerCase())
  .filter(isContestStatId))])
const trainerSkillRank = (sheet: TrainerSheet, key: string): number => Math.max(1, Math.min(6,
  resolveTrainerSkills(sheet).find(row => row.key === key)?.rankValue ?? 2,
))
export const contestTrainerIntegrations = (sheet: TrainerSheet): ContestTrainerIntegrationsV1 => {
  const featureIds = resolvedSheetFeatureClosure(sheet).map(instance => instance.canonicalId)
  const edges = resolvedSheetEdgeInstances(sheet, 'trainer').map(instance => instance.canonicalId)
  const equipped = activeEquippedItems(sheet.equipmentState)
  const itemIds = [...new Set(equipped.map(row => row.id))]
  const alignment = ['Fabulous Max','Rule of Cool','Gleeful Steps','Calculated Assault','Macho Charge'].filter(id => featureIds.includes(id))
  return Object.freeze({
    providerIds: Object.freeze([...new Set([...featureIds.map(id => `feature:${id}`), ...edges.map(id => `edge:${id}`), ...itemIds.map(id => `item:${id}`)])]),
    hasGrace: sheetHasCanonicalEdge(sheet, 'trainer', 'Grace'),
    hasGroomer: sheetHasCanonicalEdge(sheet, 'trainer', 'Groomer'),
    hasCoordinator: sheetHasCanonicalFeature(sheet, 'Coordinator'),
    hasReliablePerformance: sheetHasCanonicalFeature(sheet, 'Reliable Performance'),
    hasStyleFlourish: sheetHasCanonicalFeature(sheet, 'Style Flourish'),
    styleFlourishStatIds: contestStatChoiceValues(sheet, 'Style Flourish'),
    hasJugglingShow: sheetHasCanonicalFeature(sheet, 'Juggling Show'),
    voiceLessons: sheetHasCanonicalFeature(sheet, 'Voice Lessons'),
    styleExpertStatIds: contestStatChoiceValues(sheet, 'Style Expert'),
    alignmentInterventionIds: Object.freeze(alignment),
    acrobaticsHalfRankDice: Math.floor(trainerSkillRank(sheet, 'acrobatics') / 2),
    fancyClothesStatIds: Object.freeze(equipped.filter(row => row.id === 'Fancy Clothes').flatMap(row => statChoicesFrom(row.values))),
  })
}

const activeEquippedItems = (state: SheetEquipmentStateV1 | undefined): readonly { readonly id: string, readonly values: unknown }[] => {
  if (!state) return Object.freeze([])
  const assigned = new Set(state.slots.flatMap(slot => slot.instanceId ? [slot.instanceId] : []))
  return Object.freeze(state.instances.filter(instance => assigned.has(instance.instanceId) && instance.activity.status === 'active')
    .map(instance => ({ id: instance.canonicalItemId, values: instance.configuration?.values ?? {} })))
}
const statChoicesFrom = (value: unknown): readonly ContestStatId[] => {
  const found: ContestStatId[] = []
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 5) return
    if (typeof candidate === 'string' && isContestStatId(candidate.toLowerCase())) found.push(candidate.toLowerCase() as ContestStatId)
    else if (Array.isArray(candidate)) candidate.slice(0, 20).forEach(row => visit(row, depth + 1))
    else if (candidate && typeof candidate === 'object') Object.values(candidate as Record<string, unknown>).slice(0, 30).forEach(row => visit(row, depth + 1))
  }
  visit(value, 0)
  return Object.freeze([...new Set(found)])
}

export interface ContestPokemonIntegrationsV1 {
  readonly providerIds: readonly string[]
  readonly abilityIds: readonly string[]
  readonly itemIds: readonly string[]
  readonly hasContestAccessory: boolean
  readonly contestFashionStatIds: readonly ContestStatId[]
  readonly hasBeautiful: boolean
  readonly hasFashionDesigner: boolean
  readonly hasUgly: boolean
  readonly playingGodColorationStatId: ContestStatId | null
}
export const contestPokemonIntegrations = (sheet: CharacterSheet): ContestPokemonIntegrationsV1 => {
  const abilityIds = [...new Set((sheet.abilities ?? []).map(row => row.automation?.canonicalId ?? row.name).filter(Boolean))]
  const equipped = activeEquippedItems(sheet.equipmentState)
  const itemIds = [...new Set(equipped.map(row => row.id))]
  const coloration = sheet.serverPrivate?.breedingProviderTraits?.playingGod?.colorationContestStatId ?? null
  return Object.freeze({
    providerIds: Object.freeze([...abilityIds.map(id => `ability:${id}`), ...itemIds.map(id => `item:${id}`), ...(coloration ? [`feature:Playing God:${coloration}`] : [])]),
    abilityIds: Object.freeze(abilityIds), itemIds: Object.freeze(itemIds),
    hasContestAccessory: itemIds.includes('Contest Accessory'),
    contestFashionStatIds: Object.freeze(equipped.filter(row => row.id === 'Contest Fashion').flatMap(row => statChoicesFrom(row.values))),
    hasBeautiful: abilityIds.includes('Beautiful'), hasFashionDesigner: abilityIds.includes('Fashion Designer'), hasUgly: abilityIds.includes('Ugly'),
    playingGodColorationStatId: isContestStatId(coloration) ? coloration : null,
  })
}

const virtualMoveSets: Readonly<Record<string, { readonly statId: ContestStatId, readonly moves: readonly string[] }>> = Object.freeze({
  'Beautiful Ballet': { statId: 'beauty', moves: ['Captivate','Mist','Lovely Kiss','Mean Look'] },
  'Cool Conduct': { statId: 'cool', moves: ['Focus Energy','Noble Roar','Roar','Double Team'] },
  'Cute Cuddle': { statId: 'cute', moves: ['Charm','Block','Teeter Dance','Attract'] },
  'Smart Scheme': { statId: 'smart', moves: ['Fake Tears','Calm Mind','Taunt','Flatter'] },
  'Tough Tumble': { statId: 'tough', moves: ['Scary Face','Spite','Glare','Bide'] },
})
const moveOption = (input: string | CharacterSheetMove | TrainerMove, source: ContestMoveOptionV1['source']): ContestMoveOptionV1 => {
  const name = typeof input === 'string' ? input : input.name
  const bound = typeof input === 'string' || !('contestIdentity' in input) ? undefined : input.contestIdentity
  const sonic = typeof input === 'string' ? false : String(input.range ?? '').toLowerCase().includes('sonic')
  if (bound?.schemaVersion === 1 && bound.status === 'defined' && isContestStatId(bound.typeId) && isContestEffectId(bound.effectId)) return Object.freeze({ optionId: `created-move:${optionSlug(name)}`, canonicalMoveId: `created:${name}`, label: name, typeId: bound.typeId, effectId: bound.effectId, tags: Object.freeze(sonic ? ['sonic'] : []), source, available: true, unavailableCode: null, unavailableReason: null })
  const canonical = moveByIdentity.get(normalized(name))
  if (!canonical) {
    const weaponMove = capabilityWeaponMove(name)
    if (weaponMove) return Object.freeze({ optionId: `weapon-move:${optionSlug(name)}`, canonicalMoveId: name, label: name, typeId: null, effectId: null, tags: Object.freeze([]), source, available: false, unavailableCode: 'weapon-move-no-canonical-contest-identity', unavailableReason: 'Weapon Moves have no reviewed canonical Contest identity.' })
    return Object.freeze({ optionId: `unavailable:${optionSlug(name)}`, canonicalMoveId: name, label: name, typeId: null, effectId: null, tags: Object.freeze([]), source, available: false, unavailableCode: 'contest.move-identity-missing', unavailableReason: 'This created or unknown Move needs a reviewed Contest identity binding.' })
  }
  const contest = canonical.row.contest
  if (!contest || contest.status !== 'defined' || !isContestStatId(contest.typeId) || !isContestEffectId(contest.effectId)) return Object.freeze({ optionId: `move:${optionSlug(canonical.id)}`, canonicalMoveId: canonical.id, label: canonical.row.name, typeId: null, effectId: null, tags: Object.freeze([]), source, available: false, unavailableCode: contest && 'reasonCode' in contest ? contest.reasonCode ?? 'contest.move-identity-unavailable' : 'contest.move-identity-unavailable', unavailableReason: contest && 'safeReason' in contest ? contest.safeReason ?? 'Canonical Contest identity is unavailable.' : 'Canonical Contest identity is unavailable.' })
  return Object.freeze({ optionId: `move:${optionSlug(canonical.id)}`, canonicalMoveId: canonical.id, label: canonical.row.name, typeId: contest.typeId, effectId: contest.effectId, tags: Object.freeze([...new Set([...(contest.tags ?? []), ...(String(canonical.row.range ?? '').toLowerCase().includes('sonic') ? ['sonic'] : [])])]), source, available: true, unavailableCode: null, unavailableReason: null })
}

export const buildContestPerformerSnapshot = (input: {
  readonly sheet: CharacterSheet
  readonly trainer: TrainerSheet
  readonly campaignDay: number
  readonly revision: number
}): ContestPokemonPerformerSnapshotV1 => {
  const trainer = contestTrainerIntegrations(input.trainer)
  const pokemon = contestPokemonIntegrations(input.sheet)
  const preparation = derivePokemonContestPreparation(input.sheet, { hasGrace: trainer.hasGrace, styleExpertStatIds: trainer.styleExpertStatIds, campaignDay: input.campaignDay })
  const baseMoves = [...(input.sheet.movelist ?? []), ...(input.sheet.appliedMoves ?? [])].map(row => moveOption(row, 'sheet'))
  const virtualMoves = Object.entries(virtualMoveSets).flatMap(([featureId, definition]) => {
    if (!sheetHasCanonicalFeature(input.trainer, featureId) || preparation.rows[definition.statId].poffinDiceActive + preparation.rows[definition.statId].featureDice < 3) return []
    const instance = resolvedSheetFeatureClosure(input.trainer).find(row => row.canonicalId === featureId)
    return definition.moves.slice(0, instance?.rank && instance.rank >= 2 ? 4 : 2).map(name => moveOption(name, 'style-feature'))
  })
  const seen = new Set<string>()
  const moves = [...baseMoves, ...virtualMoves].filter(move => !seen.has(move.optionId) && seen.add(move.optionId))
  const dicePools = emptyContestStatRecord<ContestDicePoolV1>(statId => Object.freeze({ total: preparation.rows[statId].totalDice, remaining: preparation.rows[statId].totalDice, contributors: preparation.rows[statId].contributions }))
  return Object.freeze({
    performerKind: 'pokemon' as const,
    performerId: `performer:${optionSlug(input.sheet.slug)}`,
    pokemonSheetSlug: input.sheet.slug,
    pokemonSheetRevision: input.revision,
    displayName: input.sheet.nickname || input.sheet.species || 'Pokémon', species: input.sheet.species || 'Unknown', level: Math.max(1, Math.floor(input.sheet.level || 1)),
    portraitUrl: null, moves: Object.freeze(moves), dicePools: Object.freeze(dicePools),
    providerIds: Object.freeze([
      ...trainer.providerIds,
      ...pokemon.providerIds,
      ...trainer.fancyClothesStatIds.map(statId => `item:Fancy Clothes:${statId}`),
      ...trainer.styleFlourishStatIds.map(statId => `feature:Style Flourish:${statId}`),
      ...pokemon.contestFashionStatIds.map(statId => `item:Contest Fashion:${statId}`),
      ...(preparation.groomedToday ? ['edge:Groomer:groomed'] : []),
      ...(trainer.hasJugglingShow ? [`feature:Juggling Show:dice:${trainer.acrobaticsHalfRankDice}`] : []),
    ]),
  })
}

/**
 * Snapshot one Trainer performer from the ordinary Trainer sheet. Trainer
 * Participant Contest dice remain entry-shared authority; this performer owns
 * no parallel preparation pool and therefore starts with exact empty pools.
 */
export const buildContestTrainerPerformerSnapshot = (input: {
  readonly sheet: TrainerSheet
  readonly revision: number
}): ContestTrainerPerformerSnapshotV1 => {
  const integrations = contestTrainerIntegrations(input.sheet)
  const seen = new Set<string>()
  const moves = (input.sheet.movelist ?? [])
    .map(row => moveOption(row, 'sheet'))
    .filter(move => !seen.has(move.optionId) && seen.add(move.optionId))
  return Object.freeze({
    performerKind: 'trainer' as const,
    performerId: `performer:trainer-${optionSlug(input.sheet.slug)}`,
    trainerSheetSlug: input.sheet.slug,
    trainerSheetRevision: input.revision,
    displayName: input.sheet.name || 'Trainer',
    level: Math.max(1, Math.min(100, Math.floor(input.sheet.level || 1))),
    portraitUrl: input.sheet.portraitUrl?.trim() || null,
    moves: Object.freeze(moves),
    dicePools: emptyContestDicePools(),
    providerIds: Object.freeze([
      ...integrations.providerIds,
      ...integrations.fancyClothesStatIds.map(statId => `item:Fancy Clothes:${statId}`),
      ...integrations.styleFlourishStatIds.map(statId => `feature:Style Flourish:${statId}`),
      ...(integrations.hasJugglingShow ? [`feature:Juggling Show:dice:${integrations.acrobaticsHalfRankDice}`] : []),
    ]),
  })
}

export const contestIntroductionSkillDice = (trainer: TrainerSheet, skillId: string): number => trainerSkillRank(trainer, skillId)
export const contestPreparationForEnrollment = (sheet: CharacterSheet, trainer: TrainerSheet, campaignDay: number): PokemonContestPreparationProjectionV1 => {
  const integration = contestTrainerIntegrations(trainer)
  return derivePokemonContestPreparation(sheet, { hasGrace: integration.hasGrace, styleExpertStatIds: integration.styleExpertStatIds, campaignDay })
}
export const contestEquipmentStatChoices = statChoicesFrom
