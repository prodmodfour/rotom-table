<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { PhArrowLeft, PhCheckCircle, PhLockKey, PhPause, PhPlay, PhPulse, PhTrash, PhWarning } from '@phosphor-icons/vue'
import AppNavigation from '~/components/AppNavigation.vue'
import { useContests } from '~/composables/useContests'
import { CONTESTS_PATH } from '#shared/contests/routes'
import { CONTEST_INTRODUCTION_SKILL_IDS, CONTEST_PARTICIPANT_METHOD_IDS, CONTEST_STAT_IDS, emptyContestStatRecord, type ContestParticipantMethodId, type ContestStatId } from '#shared/contests/ids'
import { contestCatalog } from '#shared/contests/catalog'
import { encounterWorkspacePath } from '#shared/encounterWorkspace/routes'
import { type ContestGmProjectionV1, type ContestOwnerProjectionV1 } from '#shared/contests/projections'
import { assembleContestAppeal } from '#shared/contests/appealAssembly'
import { contestPerformerIsPokemon, contestPerformerIsTrainer, type ContestantStateV1, type ContestMoveOptionV1, type ContestPerformerSnapshotV1, type ContestPokemonPerformerSnapshotV1 } from '#shared/contests/document'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

interface SheetList { pokemonSheets: CharacterSheet[], trainerSheets: TrainerSheet[] }
const route = useRoute()
const cockpit = ref<HTMLElement | null>(null)
const contestId = computed(() => String(route.params.contestId ?? ''))
const { isGm, isPlayer } = useAuth()
const profiles = usePlayerProfiles()
const profileId = computed(() => profiles.selectedProfileId.value)
const runtime = useContests(profileId)
const sheets = ref<SheetList>({ pokemonSheets: [], trainerSheets: [] })
const sheetsUnavailable = ref(false)
const enrollment = reactive({ trainerSlug: '', pokemonSlugs: [] as string[], controllerId: 'gm' })
const intro = reactive({ skillId: 'charm', generatedStatId: 'cute' as ContestStatId, contestAccessoryStatId: 'cute' as ContestStatId, jugglingShowStatId: 'cute' as ContestStatId })
const appeal = reactive({ performerId: '', moveOptionId: '', partnerEffectTargetPerformerId: '', spent: emptyContestStatRecord(() => 0) })
const correction = reactive({ kind: 'appeal-delta' as 'appeal-delta'|'fumble-delta'|'voltage-delta'|'dice-pool-delta'|'controller-reassignment', contestantId: '', statId: 'cute' as ContestStatId, numericDelta: 0, replacementProfileId: '', reason: '' })
const cancelReason = ref('')
const intervention = reactive({ id: '', typeMoveOptionId: '', effectMoveOptionId: '' })

const projection = computed(() => runtime.contest.value)
const gmProjection = computed<ContestGmProjectionV1 | null>(() => projection.value && 'contestants' in projection.value ? projection.value as ContestGmProjectionV1 : null)
const ownerProjection = computed<ContestOwnerProjectionV1 | null>(() => projection.value && 'ownContestant' in projection.value ? projection.value as ContestOwnerProjectionV1 : null)
const allContestants = computed<readonly ContestantStateV1[]>(() => gmProjection.value?.contestants ?? (ownerProjection.value ? [ownerProjection.value.ownContestant] : []))
const exactAcceptedAppeals = computed(() => gmProjection.value?.acceptedAppeals ?? ownerProjection.value?.ownAcceptedAppeals ?? [])
const activeContestant = computed(() => {
  const id = projection.value?.activeContestantId
  if (!id) return null
  return gmProjection.value?.contestants.find(row => row.contestantId === id)
    ?? (ownerProjection.value?.ownContestant.contestantId === id ? ownerProjection.value.ownContestant : null)
})
const canControlActive = computed(() => Boolean(activeContestant.value && (isGm.value || ownerProjection.value?.ownsCurrentDecision)))
const legalActivePerformerIds = computed<readonly string[]>(() => {
  const owner = ownerProjection.value
  if (owner && owner.ownContestant.contestantId === activeContestant.value?.contestantId) return owner.ownLegalPerformerIds
  return gmProjection.value?.currentLegalPerformerIds ?? []
})
const participantLegalPerformers = computed<readonly ContestPerformerSnapshotV1[]>(() => projection.value?.participantVariantId === 'trainer-participant'
  ? legalActivePerformerIds.value.flatMap(id => activeContestant.value?.performers.find(row => row.performerId === id) ?? [])
  : [])
const activeRoundPokemon = computed<ContestPokemonPerformerSnapshotV1 | null>(() => {
  const contestant = activeContestant.value
  if (!contestant || !projection.value) return null
  if (projection.value.variantId !== 'rotation') return contestant.performers.find(contestPerformerIsPokemon) ?? null
  const index = contestant.rotationOrder[Math.max(0, projection.value.round - 1)]
  const performer = Number.isInteger(index) ? contestant.performers[Number(index)] : undefined
  return performer && contestPerformerIsPokemon(performer) ? performer : null
})
const pendingAppeal = computed(() => exactAcceptedAppeals.value.find(row => row.appealId === projection.value?.pendingInterventionAppealId) ?? null)
const activePerformer = computed<ContestPerformerSnapshotV1 | null>(() => {
  const contestant = activeContestant.value
  if (!contestant || !projection.value) return null
  if (pendingAppeal.value) return contestant.performers.find(row => row.performerId === pendingAppeal.value?.performerId) ?? null
  if (projection.value.participantVariantId === 'trainer-participant') return legalActivePerformerIds.value.includes(appeal.performerId) ? contestant.performers.find(row => row.performerId === appeal.performerId) ?? null : null
  return activeRoundPokemon.value
})
const sharedPoolPerformer = computed<ContestPokemonPerformerSnapshotV1 | null>(() => projection.value?.participantVariantId === 'trainer-participant' ? activeRoundPokemon.value : activePerformer.value && contestPerformerIsPokemon(activePerformer.value) ? activePerformer.value : null)
const activeProviderIds = computed<readonly string[]>(() => {
  const performer = activePerformer.value, contestant = activeContestant.value
  if (!performer || !contestant) return []
  return projection.value?.participantVariantId === 'trainer-participant'
    ? [...new Set([...performer.providerIds, ...(contestant.performers.find(contestPerformerIsTrainer)?.providerIds.filter(id => id.startsWith('feature:')) ?? [])])]
    : performer.providerIds
})
const availableRotationPerformers = computed(() => activeContestant.value?.performers.filter((row, index): row is ContestPokemonPerformerSnapshotV1 => contestPerformerIsPokemon(row) && !activeContestant.value?.rotationOrder.includes(index)) ?? [])
const activeLastMoveOptionId = computed(() => [...exactAcceptedAppeals.value].reverse().find(row => row.contestantId === activeContestant.value?.contestantId && row.performerId === activePerformer.value?.performerId)?.moveOptionId ?? null)
const selectedMove = computed(() => activePerformer.value?.moves.find(row => row.optionId === appeal.moveOptionId) ?? null)
const spentTotal = computed(() => CONTEST_STAT_IDS.reduce((sum, id) => sum + appeal.spent[id], 0))
const activeScore = computed(() => projection.value?.scoreboard.find(row => row.contestantId === activeContestant.value?.contestantId) ?? null)
const activeVoltage = computed(() => projection.value?.participantVariantId === 'trainer-participant' && projection.value.participantMethodId === 'simultaneous' && activePerformer.value
  ? activeContestant.value?.performerVoltages[activePerformer.value.performerId] ?? 0
  : activeScore.value?.voltage ?? 0)
const appealAssembly = computed(() => {
  const move = selectedMove.value, contestant = activeContestant.value, performer = activePerformer.value, contestTypeId = projection.value?.currentRoundContestTypeId, position = activeScore.value?.position
  const moveTypeId = contestant?.pendingEffects.nextAppealTypeId ?? move?.typeId, effectId = contestant?.pendingEffects.nextAppealEffectId ?? move?.effectId
  if (!move || !contestant || !performer || !moveTypeId || !effectId || !contestTypeId) return null
  const adjacentVoltages = (position?.adjacentContestantIds ?? []).flatMap(id => {
    const row = projection.value?.scoreboard.find(candidate => candidate.contestantId === id)
    return projection.value?.participantVariantId === 'trainer-participant' && projection.value.participantMethodId === 'simultaneous' ? row?.performers.map(candidate => candidate.voltage) ?? [] : [row?.voltage ?? 0]
  })
  return assembleContestAppeal({ effectId, moveTypeId, contestTypeId, spentDice: spentTotal.value, startingVoltage: activeVoltage.value, adjacentVoltages, repeatedMove: activeLastMoveOptionId.value === move.optionId, baseMoveDiceMultiplier: contestant.pendingEffects.nextRoundBaseMoveDiceMultiplier, alignmentSteps: contestant.pendingEffects.nextAppealAlignmentSteps, sonic: move.tags.includes('sonic'), voiceLessonsActive: activeProviderIds.value.includes('feature:Voice Lessons'), acceptedInterventionBonusDice: contestant.pendingEffects.nextAppealBonusDice })
})
const relationship = computed(() => appealAssembly.value?.relationship ?? null)
const roughAssembled = computed(() => appealAssembly.value?.assembledDice ?? null)
const participantPair = computed<readonly ContestPerformerSnapshotV1[]>(() => {
  const trainer = activeContestant.value?.performers.find(contestPerformerIsTrainer), pokemon = activeRoundPokemon.value
  return trainer && pokemon ? [trainer, pokemon] : []
})
const participantChoiceHeading = computed(() => projection.value?.participantMethodId === 'simultaneous' && participantLegalPerformers.value.length > 1 ? 'Choose who appeals first' : 'Choose this appeal’s performer')
const performerVoltage = (performer: ContestPerformerSnapshotV1): number => projection.value?.participantMethodId === 'simultaneous'
  ? activeContestant.value?.performerVoltages[performer.performerId] ?? 0
  : activeScore.value?.voltage ?? 0
const effectiveAppealEffectId = computed(() => activeContestant.value?.pendingEffects.nextAppealEffectId ?? selectedMove.value?.effectId ?? null)
const partnerEffectPerformer = computed(() => projection.value?.participantVariantId === 'trainer-participant' && projection.value.participantMethodId === 'simultaneous' && activePerformer.value && ['get-ready','attention-grabber'].includes(effectiveAppealEffectId.value ?? '')
  ? participantPair.value.find(row => row.performerId !== activePerformer.value?.performerId) ?? null
  : null)
const pendingIntroductions = computed(() => gmProjection.value?.contestants.filter(row => row.introduction.status === 'pending') ?? [])
const introductionActor = computed(() => isGm.value ? pendingIntroductions.value[0] ?? null : ownerProjection.value?.ownContestant.introduction.status === 'pending' ? ownerProjection.value.ownContestant : null)
const introductionMappedStat = computed(() => contestCatalog.contestStats.find(row => row.introductionSkillId === intro.skillId)?.id ?? 'cute')
const isBattleIntroduction = computed(() => projection.value?.variantId === 'battle' && projection.value.stage === 'introduction')
const introductionProviders = computed(() => {
  const actor = introductionActor.value
  if (projection.value?.variantId === 'battle') {
    const pokemon = actor?.performers.filter(contestPerformerIsPokemon) ?? []
    if (!pokemon.length) return []
    const retainedByEveryTeamMember = pokemon[0]!.providerIds.filter(providerId => pokemon.every(performer => performer.providerIds.includes(providerId)))
    return retainedByEveryTeamMember.filter(providerId => providerId === 'edge:Grace' || providerId.startsWith('item:Fancy Clothes:') || providerId.startsWith('feature:Playing God:') || providerId.startsWith('feature:Juggling Show:dice:'))
  }
  return projection.value?.participantVariantId === 'trainer-participant'
    ? [...new Set(actor?.performers.flatMap(row => row.providerIds) ?? [])]
    : actor?.performers.find(contestPerformerIsPokemon)?.providerIds ?? []
})
const introductionHasGrace = computed(() => introductionProviders.value.includes('edge:Grace'))
const introductionStatOptions = computed(() => introductionHasGrace.value ? CONTEST_STAT_IDS : [introductionMappedStat.value])
const introductionHasContestAccessory = computed(() => introductionProviders.value.includes('item:Contest Accessory'))
const introductionJugglingDice = computed(() => {
  const provider = introductionProviders.value.find(id => id.startsWith('feature:Juggling Show:dice:'))
  return provider ? Number(provider.split(':').at(-1)) || 0 : 0
})
const introductionBonusLabels = computed(() => {
  const labels: string[] = []
  if (introductionProviders.value.includes('edge:Groomer:groomed')) labels.push(`Groomer +1d6 → ${pretty(intro.generatedStatId)}`)
  for (const statId of CONTEST_STAT_IDS) if (introductionProviders.value.includes(`item:Fancy Clothes:${statId}`)) labels.push(`Fancy Clothes +2d6 → ${pretty(statId)}`)
  if (introductionHasContestAccessory.value) labels.push(`Contest Accessory +2d6 → ${pretty(intro.contestAccessoryStatId)}`)
  for (const statId of CONTEST_STAT_IDS) if (introductionProviders.value.includes(`feature:Playing God:${statId}`)) labels.push(`Playing God +2d6 → ${pretty(statId)}`)
  if (introductionJugglingDice.value) labels.push(`Juggling Show +${introductionJugglingDice.value}d6 → ${pretty(intro.jugglingShowStatId)}`)
  return labels
})
const introductionPreviewDice = computed(() => (introductionActor.value?.introductionSkillDice[intro.skillId as keyof ContestantStateV1['introductionSkillDice']] ?? 2) + introductionBonusLabels.value.reduce((sum, label) => sum + (Number(label.match(/\+(\d+)d6/u)?.[1]) || 0), 0))
const allIntroduced = computed(() => Boolean(gmProjection.value?.contestants.length && gmProjection.value.contestants.every(row => row.introduction.status === 'accepted')))
const battleIntroductionAcceptedCount = computed(() => gmProjection.value?.contestants.filter(row => row.introduction.status === 'accepted').length ?? (ownerProjection.value?.ownContestant.introduction.status === 'accepted' ? 1 : 0))
const battleTeamPoolTotal = (contestant: ContestantStateV1): number => CONTEST_STAT_IDS.reduce((sum, statId) => sum + contestant.teamDicePools[statId].total, 0)
const battleTeamPoolRemaining = (contestant: ContestantStateV1): number => CONTEST_STAT_IDS.reduce((sum, statId) => sum + contestant.teamDicePools[statId].remaining, 0)
const battleEncounter = computed(() => projection.value?.variantId === 'battle' ? projection.value.battle?.encounter ?? null : null)
const isBattlePerformance = computed(() => projection.value?.variantId === 'battle' && projection.value.stage === 'performance' && battleEncounter.value !== null)
const battleEncounterPath = computed(() => battleEncounter.value ? encounterWorkspacePath(battleEncounter.value.encounterId) : '/play')
const profileOptions = computed(() => profiles.profiles.value)
const availablePokemon = computed(() => sheets.value.pokemonSheets.filter(sheet => !gmProjection.value?.contestants.some(row => row.performers.some(performer => contestPerformerIsPokemon(performer) && performer.pokemonSheetSlug === sheet.slug))))
const isBattleSetup = computed(() => projection.value?.variantId === 'battle' && projection.value.stage === 'setup')
const battleTeamCount = computed(() => gmProjection.value?.contestants.length ?? projection.value?.scoreboard.length ?? 0)
const battleRosterSize = computed(() => projection.value?.battle?.declaredPokemonPerTrainer ?? null)
const battleRoundBudget = computed(() => projection.value?.battle?.roundBudget ?? null)
const battleSelectionRequirement = computed(() => battleRosterSize.value === null ? 'choose 3–6' : `choose exactly ${battleRosterSize.value}`)
const battleSelectionValid = computed(() => battleRosterSize.value === null
  ? enrollment.pokemonSlugs.length >= 3 && enrollment.pokemonSlugs.length <= 6
  : enrollment.pokemonSlugs.length === battleRosterSize.value)
const enrollmentReady = computed(() => Boolean(enrollment.trainerSlug && enrollment.pokemonSlugs.length && (!isBattleSetup.value || battleTeamCount.value < 2 && battleSelectionValid.value)))
const setupReady = computed(() => isBattleSetup.value
  ? battleTeamCount.value === 2 && battleRosterSize.value !== null && battleRoundBudget.value === battleRosterSize.value * 2
  : (projection.value?.scoreboard.length ?? 0) >= 3 && (projection.value?.participantVariantId !== 'trainer-participant' || Boolean(projection.value.participantMethodId)))
const setupLockLabel = computed(() => isBattleSetup.value ? 'Lock 2 teams and begin introductions' : `Lock ${projection.value?.scoreboard.length ?? 0} contestants and begin introductions`)
const contestantPokemon = (contestant: ContestantStateV1): readonly ContestPokemonPerformerSnapshotV1[] => contestant.performers.filter(contestPerformerIsPokemon)
const actionableInterventionNames = ['Reliable Performance','Adaptable Performance','Fabulous Max','Rule of Cool','Gleeful Steps','Calculated Assault','Macho Charge','Fashion Designer','Beautiful','Coordinator','Style Flourish','Contest Fashion']
const interventionWasUsed = (name: string): boolean => Boolean(activeContestant.value?.usedInterventionIds.includes(name)
  || activePerformer.value && activeContestant.value?.usedInterventionIds.includes(`${name}@${activePerformer.value.performerId}`))
const offeredInterventions = computed(() => {
  const providers = activeProviderIds.value
  return actionableInterventionNames.filter(name => providers.some(provider => provider === `feature:${name}` || provider === `ability:${name}` || provider === `item:${name}` || provider.startsWith(`feature:${name}:`) || provider.startsWith(`item:${name}:`)) && !interventionWasUsed(name))
})
const latestAppeal = computed(() => projection.value?.acceptedAppeals.at(-1) ?? null)
const postInterventionIds = ['Coordinator','Style Flourish','Contest Fashion']
const preOfferedInterventions = computed(() => offeredInterventions.value.filter(id => !postInterventionIds.includes(id)))
const postOfferedInterventions = computed(() => offeredInterventions.value.filter((id) => {
  if (!postInterventionIds.includes(id) || !pendingAppeal.value || !activePerformer.value) return false
  if (id === 'Coordinator') return pendingAppeal.value.acceptedResults.length > 0
  if (!pendingAppeal.value.acceptedResults.includes(1)) return false
  const prefix = id === 'Style Flourish' ? 'feature' : 'item'
  return activeProviderIds.value.includes(`${prefix}:${id}:${pendingAppeal.value.moveTypeId}`)
}))
const interventionReady = computed(() => Boolean(intervention.id && (intervention.id !== 'Adaptable Performance' || (intervention.typeMoveOptionId && intervention.effectMoveOptionId && intervention.typeMoveOptionId !== intervention.effectMoveOptionId))))

const contestantId = (): string => `contestant:${globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 16) ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`}`
const commandBase = () => ({ contestId: contestId.value, expectedRevision: projection.value?.revision ?? 0 })
const focusPrimaryDecision = async (): Promise<void> => {
  await nextTick()
  cockpit.value?.querySelector<HTMLElement>('[data-contest-primary]')?.focus({ preventScroll: true })
}
const enroll = async (): Promise<void> => {
  if (!enrollmentReady.value) return
  const rotationOrder = projection.value?.variantId === 'rotation' && projection.value.rotationOrderPolicy === 'predeclared' ? enrollment.pokemonSlugs.map((_, index) => index) : []
  const result = await runtime.execute({ ...commandBase(), commandKind: 'enroll-contestant', contestantId: contestantId(), trainerSheetSlug: enrollment.trainerSlug, pokemonSheetSlugs: [...enrollment.pokemonSlugs], controller: enrollment.controllerId === 'gm' ? { kind: 'gm' } : { kind: 'profile', profileId: enrollment.controllerId as never }, rotationOrder })
  if (result) { enrollment.trainerSlug = ''; enrollment.pokemonSlugs = []; enrollment.controllerId = 'gm'; await focusPrimaryDecision() }
}
const removeContestant = (id: string) => runtime.execute({ ...commandBase(), commandKind: 'remove-contestant', contestantId: id })
const setParticipantMethod = async (participantMethodId: ContestParticipantMethodId): Promise<void> => {
  if (await runtime.execute({ ...commandBase(), commandKind: 'set-participant-method', participantMethodId })) await focusPrimaryDecision()
}
const stageCommand = async (kind: 'start-introduction'|'restart-introduction'|'start-performance'|'declare-prize'|'prepare-settlement'|'commit-settlement'): Promise<void> => {
  if (await runtime.execute({ ...commandBase(), commandKind: kind })) await focusPrimaryDecision()
}
const createBattleEncounter = async (): Promise<void> => {
  if (!isGm.value || !allIntroduced.value || !isBattleIntroduction.value) return
  if (await runtime.execute({ ...commandBase(), commandKind: 'create-battle-encounter' })) await focusPrimaryDecision()
}
const declareIntroduction = async (): Promise<void> => {
  if (!introductionActor.value) return
  const bonusStatIds = {
    ...(introductionHasContestAccessory.value ? { contestAccessory: intro.contestAccessoryStatId } : {}),
    ...(introductionJugglingDice.value ? { jugglingShow: intro.jugglingShowStatId } : {}),
  }
  if (await runtime.execute({ ...commandBase(), commandKind: 'declare-introduction', contestantId: introductionActor.value.contestantId, skillId: intro.skillId as never, generatedStatId: intro.generatedStatId, bonusStatIds })) await focusPrimaryDecision()
}
const moveDecisionReason = (move: ContestMoveOptionV1): string | null => {
  if (!move.available) return move.unavailableReason ?? 'This Move has no canonical Contest identity.'
  if (activeLastMoveOptionId.value === move.optionId && move.effectId !== 'reliable') return 'A Move cannot be used on consecutive appeals unless its effect is Reliable.'
  const pending = activeContestant.value?.pendingEffects
  if (pending?.nextAppealTypeId && pending.nextAppealEffectId && pending.blockedMoveRound === (projection.value?.round ?? 0) + 1 && !pending.blockedMoveOptionIds.includes(move.optionId)) return 'Adaptable Performance must use one of its two selected source Moves for this appeal.'
  if (pending && pending.blockedMoveRound === projection.value?.round && pending.blockedMovePerformerId === activePerformer.value?.performerId && pending.blockedMoveOptionIds.includes(move.optionId)) return 'Adaptable Performance blocks this source Move for the current round.'
  if (pending && pending.nextAppealAlignmentTypeId && pending.nextAppealAlignmentTypeId !== (pending.nextAppealTypeId ?? move.typeId)) return `The accepted alignment intervention requires a ${pretty(pending.nextAppealAlignmentTypeId)} Move.`
  return null
}
const activePoolRemaining = (statId: ContestStatId): number => (sharedPoolPerformer.value?.dicePools[statId].remaining ?? 0) + (projection.value?.variantId === 'rotation' ? activeContestant.value?.teamDicePools[statId].remaining ?? 0 : 0)
const rotationTeamRemaining = computed(() => projection.value?.variantId === 'rotation' && activeContestant.value ? Math.max(0, projection.value.scoreboard.length * 2 - activeContestant.value.teamContestDiceSpent) : null)
const selectRotationPerformer = async (performerId: string): Promise<void> => {
  if (!activeContestant.value) return
  if (await runtime.execute({ ...commandBase(), commandKind: 'select-rotation-performer', contestantId: activeContestant.value.contestantId, performerId })) await focusPrimaryDecision()
}
const selectParticipantPerformer = (performerId: string): void => {
  if (!legalActivePerformerIds.value.includes(performerId)) return
  appeal.performerId = performerId
  appeal.partnerEffectTargetPerformerId = ''
}
const setSpend = (statId: ContestStatId, delta: number): void => {
  const max = Math.min(activePoolRemaining(statId), rotationTeamRemaining.value ?? Number.POSITIVE_INFINITY)
  const next = Math.max(0, Math.min(max, appeal.spent[statId] + delta))
  if (spentTotal.value - appeal.spent[statId] + next <= Math.min(contestCatalog.performance.contestDiceSpendMaximumPerAppeal, rotationTeamRemaining.value ?? Number.POSITIVE_INFINITY)) appeal.spent[statId] = next
}
const submitAppeal = async (): Promise<void> => {
  if (!activeContestant.value || !activePerformer.value || !appeal.moveOptionId) return
  const accepted = await runtime.execute({ ...commandBase(), commandKind: 'declare-appeal', contestantId: activeContestant.value.contestantId, performerId: activePerformer.value.performerId, moveOptionId: appeal.moveOptionId, partnerEffectTargetPerformerId: appeal.partnerEffectTargetPerformerId || null, spentDice: { ...appeal.spent } })
  if (accepted) { appeal.moveOptionId = ''; appeal.partnerEffectTargetPerformerId = ''; Object.assign(appeal.spent, emptyContestStatRecord(() => 0)); await focusPrimaryDecision() }
}
const passIntervention = async (): Promise<void> => {
  if (!activeContestant.value || !projection.value?.pendingInterventionAppealId) return
  if (await runtime.execute({ ...commandBase(), commandKind: 'pass-intervention', contestantId: activeContestant.value.contestantId, appealId: projection.value.pendingInterventionAppealId })) await focusPrimaryDecision()
}
const useIntervention = async (): Promise<void> => {
  if (!activeContestant.value || !intervention.id) return
  const choices: Record<string,string|number|boolean> = {}
  if (intervention.id === 'Adaptable Performance') { choices.typeMoveOptionId = intervention.typeMoveOptionId; choices.effectMoveOptionId = intervention.effectMoveOptionId }
  const accepted = await runtime.execute({ ...commandBase(), commandKind: 'use-intervention', contestantId: activeContestant.value.contestantId, interventionId: intervention.id, targetContestantId: null, targetPerformerId: projection.value?.participantVariantId === 'trainer-participant' ? activePerformer.value?.performerId ?? null : null, appealId: ['Coordinator','Style Flourish','Contest Fashion'].includes(intervention.id) ? projection.value?.pendingInterventionAppealId ?? null : null, choices })
  if (accepted) { intervention.id = ''; await focusPrimaryDecision() }
}
const applyCorrection = async (): Promise<void> => {
  const accepted = await runtime.execute({ ...commandBase(), commandKind: 'apply-correction', correctionKind: correction.kind, contestantId: correction.contestantId || null, statId: correction.kind === 'dice-pool-delta' ? correction.statId : null, numericDelta: correction.kind === 'controller-reassignment' ? null : correction.numericDelta, replacementProfileId: correction.kind === 'controller-reassignment' && correction.replacementProfileId ? correction.replacementProfileId as never : null, reason: correction.reason })
  if (accepted) { correction.reason = ''; correction.numericDelta = 0 }
}
const cancelContest = async (): Promise<void> => { if (cancelReason.value.trim()) await runtime.execute({ ...commandBase(), commandKind: 'cancel-contest', reason: cancelReason.value }) }
const togglePause = () => runtime.execute({ ...commandBase(), commandKind: 'set-paused', paused: !projection.value?.paused })
const pretty = (value: string | null | undefined) => value ? value.replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase()) : '—'
const settlementPokemonLabel = (contestantId: string, index: number, count: number): string => count === 1
  ? projection.value?.scoreboard.find(row => row.contestantId === contestantId)?.pokemonName ?? 'Pokémon'
  : `Team Pokémon ${index + 1}`
const settlementPrizeTargetLabel = (contestantId: string | null): string => contestantId
  ? projection.value?.scoreboard.find(row => row.contestantId === contestantId)?.displayName ?? 'enrolled Trainer'
  : 'winning Trainer'
const loadSheets = async (): Promise<void> => {
  const audience = profileId.value
  try { const response = await $fetch<SheetList>('/api/sheets/list', { query: audience ? { profileId: audience } : {} }); if (audience === profileId.value) { sheets.value = response; sheetsUnavailable.value = false } }
  catch { if (audience === profileId.value) sheetsUnavailable.value = true /* The Contest remains viewable when ordinary sheets are unavailable. */ }
}

watch(profileId, () => { sheets.value = { pokemonSheets: [], trainerSheets: [] }; void loadSheets() })
watch(contestId, (next, previous) => { if (next && next !== previous) void runtime.load(next) })
watch(() => runtime.error.value, async (message) => {
  if (!message) return
  await nextTick()
  const target = cockpit.value?.querySelector<HTMLElement>('.message--error button, .action-panel button:not(:disabled), .action-panel select:not(:disabled), .action-panel input:not(:disabled)')
  target?.focus()
})
watch([postOfferedInterventions, preOfferedInterventions], ([post, pre]) => { if (intervention.id && ![...post, ...pre].includes(intervention.id)) intervention.id = '' })
watch([legalActivePerformerIds, activeRoundPokemon, pendingAppeal], ([legal, pokemon, pending]) => {
  if (pending) return
  if (projection.value?.participantVariantId === 'trainer-participant') {
    if (legal.length === 1) appeal.performerId = legal[0]!
    else if (!legal.includes(appeal.performerId)) appeal.performerId = ''
  } else appeal.performerId = pokemon?.performerId ?? ''
}, { immediate: true })
watch([activePerformer, () => activeContestant.value?.pendingEffects], ([next]) => {
  appeal.moveOptionId = next?.moves.find(row => !moveDecisionReason(row))?.optionId ?? ''
  appeal.partnerEffectTargetPerformerId = ''
  Object.assign(appeal.spent, emptyContestStatRecord(() => 0))
}, { immediate: true })
watch(() => intro.skillId, () => { intro.generatedStatId = introductionMappedStat.value; intro.contestAccessoryStatId = introductionMappedStat.value; intro.jugglingShowStatId = introductionMappedStat.value })
onMounted(async () => {
  if (isPlayer.value) profiles.loadRememberedProfile()
  await Promise.all([profiles.reloadProfiles({ silent: true, clearMissingSelection: true }).catch(() => undefined), runtime.load(contestId.value), loadSheets()])
})
useHead(() => ({ title: `${projection.value?.display.name ?? 'Contest'} · Rotom Table` }))
</script>

<template>
  <main ref="cockpit" class="contest-cockpit rt-design-system" data-rt-design-system="1" data-rt-context="live-encounter">
    <AppNavigation />
    <header class="contest-header">
      <NuxtLink :to="CONTESTS_PATH" class="back-link"><PhArrowLeft :size="18" aria-hidden="true" /> All Contests</NuxtLink>
      <div v-if="projection" class="contest-heading">
        <p>{{ projection.display.hallName }}</p>
        <h1>{{ projection.display.name }}</h1>
        <div class="header-meta"><span>{{ pretty(projection.variantId) }}</span><span v-if="projection.participantMethodId">{{ pretty(projection.participantMethodId) }}</span><span>{{ pretty(projection.currentRoundContestTypeId ?? projection.contestTypeId) }}</span><span>{{ pretty(projection.stage) }}</span><span v-if="projection.round">Round {{ projection.round }} of {{ projection.variantId === 'battle' ? battleRoundBudget : projection.scoreboard.filter(row => row.active).length }}</span></div>
      </div>
      <div v-else class="contest-heading"><p>Contest hall</p><h1>{{ runtime.loading.value ? 'Loading Contest…' : 'Contest unavailable' }}</h1></div>
      <button v-if="isGm && projection && ['introduction','performance','settling'].includes(projection.stage)" type="button" class="pause-action" :aria-pressed="projection.paused" :disabled="runtime.submitting.value" @click="togglePause"><component :is="projection.paused ? PhPlay : PhPause" :size="18" />{{ projection.paused ? 'Resume' : 'Pause' }}</button>
    </header>

    <p v-if="runtime.error.value" class="message message--error" role="alert"><PhWarning :size="20" aria-hidden="true" />{{ runtime.error.value }}<button v-if="runtime.uncertainCommand.value" type="button" class="quiet-action" :disabled="runtime.submitting.value" @click="runtime.retryUncertain">Retry exact command</button><button v-else type="button" class="quiet-action" :disabled="runtime.loading.value" @click="runtime.load(contestId)">Retry load</button></p>
    <p v-if="runtime.notice.value" class="message message--accepted" role="status"><PhCheckCircle :size="20" aria-hidden="true" />{{ runtime.notice.value }}</p>
    <p class="sr-only" role="status" aria-live="polite">{{ latestAppeal ? `Round ${latestAppeal.round}: ${latestAppeal.moveLabel} accepted for ${latestAppeal.appealDelta} Appeal, ${latestAppeal.fumbleDelta} Fumble, Voltage ${latestAppeal.voltageAfter}.` : '' }}</p>
    <p v-if="runtime.loading.value && !projection" class="loading-state">Loading Contest authority…</p>

    <template v-if="projection">
      <section v-if="projection.scoreboard.length && !(projection.variantId === 'battle' && ['setup','introduction','performance'].includes(projection.stage))" class="stage-line" aria-label="Contest stage positions">
        <article v-for="row in projection.scoreboard" :key="row.contestantId" class="performer-card" :class="{ 'performer-card--active': row.contestantId === projection.activeContestantId }">
          <div class="pair-portraits" aria-hidden="true"><template v-for="member in row.performers" :key="`${member.performerKind}:${member.displayName}`"><img v-if="member.portraitUrl" :src="member.portraitUrl" alt="" /><span v-else class="portrait-fallback">{{ member.performerKind === 'trainer' ? 'T' : row.letter ?? 'P' }}</span></template></div>
          <div><strong>{{ row.performers.map(member => member.displayName).join(' + ') || row.pokemonName }}</strong><small>{{ row.displayName }}</small><em v-if="row.position?.centerOfAttention">Center of attention</em></div>
          <b>{{ row.letter ?? '—' }}</b>
          <dl><div><dt>Appeal</dt><dd>{{ row.appeal }}</dd></div><div><dt>Fumble</dt><dd>{{ row.fumble }}</dd></div><div><dt>Voltage</dt><dd><template v-if="projection.participantMethodId === 'simultaneous'"><span v-for="member in row.performers" :key="member.performerKind" :title="`${pretty(member.performerKind)} Voltage`">{{ member.performerKind === 'trainer' ? 'T' : 'P' }} {{ member.voltage }}</span></template><template v-else>{{ row.voltage }}</template></dd></div><div><dt>Score</dt><dd>{{ row.finalScore }}</dd></div></dl>
        </article>
      </section>

      <div class="cockpit-grid">
        <div class="primary-column">
          <section v-if="projection.stage === 'setup'" class="action-panel" aria-labelledby="setup-title">
            <div class="panel-heading"><p>{{ isBattleSetup ? 'Battle Contest setup' : 'Contest Workshop' }}</p><h2 id="setup-title" tabindex="-1" data-contest-primary>{{ isBattleSetup ? battleTeamCount === 0 ? 'Enroll the first team' : battleTeamCount === 1 ? 'Enroll the opposing team' : 'Both teams are ready' : 'Enroll contestants' }}</h2></div>
            <section v-if="isBattleSetup" class="battle-setup-progress" aria-label="Battle Contest setup progress">
              <div><strong>{{ battleTeamCount }} of 2 teams ready</strong><span>{{ battleTeamCount < 2 ? 'Equal rosters are required before setup can lock.' : 'Both equal rosters are accepted.' }}</span></div>
              <dl><div><dt>Trainers</dt><dd>2</dd></div><div><dt>Roster</dt><dd>{{ battleRosterSize === null ? '3–6 each' : `${battleRosterSize} each` }}</dd></div><div><dt>Rounds</dt><dd>{{ battleRoundBudget ?? 'Derived' }}</dd></div><div><dt>Type</dt><dd>{{ pretty(projection.contestTypeId) }}</dd></div></dl>
            </section>
            <template v-if="isGm">
              <p v-if="sheetsUnavailable" class="message message--error" role="alert">Ordinary sheet choices are temporarily unavailable. Existing Contest authority remains readable; retry by reloading before enrollment.</p>
              <fieldset v-if="projection.participantVariantId === 'trainer-participant'" class="method-policy">
                <legend>Trainer Participant method</legend>
                <p>{{ projection.participantMethodId === 'simultaneous' ? 'Trainer and Pokémon each appeal once per round; their controller chooses who goes first.' : projection.participantMethodId === 'alternating' ? 'Trainer and Pokémon alternate one appeal per entry round.' : 'Choose the source-bound appeal schedule before locking setup.' }}</p>
                <button v-for="methodId in CONTEST_PARTICIPANT_METHOD_IDS" :key="methodId" type="button" :class="projection.participantMethodId === methodId ? 'primary-action' : 'quiet-action'" :aria-pressed="projection.participantMethodId === methodId" :disabled="runtime.submitting.value" @click="setParticipantMethod(methodId)">{{ pretty(methodId) }}</button>
              </fieldset>
              <p v-if="isBattleSetup && battleTeamCount === 1" class="battle-setup-instruction">Team 1 locked this Battle Contest to <strong>{{ battleRosterSize }} Pokémon per side</strong> and <strong>{{ battleRoundBudget }} rounds</strong>.</p>
              <form v-if="!isBattleSetup || battleTeamCount < 2" class="enrollment-form" @submit.prevent="enroll">
                <label><span>Trainer sheet</span><select v-model="enrollment.trainerSlug" required><option value="">Choose a Trainer</option><option v-for="trainer in sheets.trainerSheets" :key="trainer.slug" :value="trainer.slug">{{ trainer.name || trainer.slug }}</option></select></label>
                <label><span>{{ projection.variantId === 'rotation' ? 'Performer sheets (in round order)' : isBattleSetup ? `Pokémon roster · ${battleSelectionRequirement}` : 'Pokémon sheet' }}</span><select v-model="enrollment.pokemonSlugs" :multiple="projection.variantId === 'rotation' || isBattleSetup" :size="isBattleSetup ? 6 : projection.variantId === 'rotation' ? 5 : undefined" required><option v-for="pokemon in availablePokemon" :key="pokemon.slug" :value="pokemon.slug">{{ pokemon.nickname || pokemon.species || pokemon.slug }}</option></select><small v-if="isBattleSetup">{{ enrollment.pokemonSlugs.length }} selected · eligibility is verified on acceptance.</small></label>
                <label><span>Controller</span><select v-model="enrollment.controllerId"><option value="gm">GM</option><option v-for="profile in profileOptions" :key="profile.id" :value="profile.id">{{ profile.displayName }}</option></select><small v-if="isBattleSetup">A selected profile must control this Trainer and every roster Pokémon.</small></label>
                <button class="primary-action" :disabled="!enrollmentReady || runtime.submitting.value">{{ isBattleSetup ? `Enroll Team ${battleTeamCount + 1} snapshot` : 'Enroll snapshot' }}</button>
              </form>
              <ul v-if="isBattleSetup" class="battle-team-grid" aria-label="Accepted Battle Contest teams"><li v-for="(contestant,index) in gmProjection?.contestants" :key="contestant.contestantId" class="battle-team-card"><header><span><small>Team {{ index + 1 }} · accepted</small><strong>{{ contestant.displayName }}</strong><em>{{ contestant.controller.kind === 'gm' ? 'GM controlled' : 'Player controlled' }}</em></span><button type="button" class="icon-action" :aria-label="`Remove Team ${index + 1}, ${contestant.displayName}`" :disabled="runtime.submitting.value" @click="removeContestant(contestant.contestantId)"><PhTrash :size="18" /></button></header><ol><li v-for="performer in contestantPokemon(contestant)" :key="performer.performerId"><span class="battle-roster-portrait" aria-hidden="true">{{ performer.displayName.slice(0,1) }}</span><strong>{{ performer.displayName }}</strong><PhCheckCircle :size="18" aria-label="Accepted" /></li></ol></li></ul>
              <ul v-else class="enrolled-list"><li v-for="contestant in gmProjection?.contestants" :key="contestant.contestantId"><span><strong>{{ contestant.displayName }}</strong><small>{{ contestant.performers.map(row => row.displayName).join(' · ') }} · {{ contestant.controller.kind === 'gm' ? 'GM controlled' : 'Player controlled' }}</small></span><button type="button" class="icon-action" :aria-label="`Remove ${contestant.displayName}`" :disabled="runtime.submitting.value" @click="removeContestant(contestant.contestantId)"><PhTrash :size="18" /></button></li></ul>
              <button type="button" class="primary-action start-action" :disabled="!setupReady || runtime.submitting.value" @click="stageCommand('start-introduction')"><PhLockKey v-if="isBattleSetup" :size="18" />{{ setupLockLabel }}</button>
              <p v-if="isBattleSetup && !setupReady" class="bounded-note"><PhLockKey :size="17" /> {{ battleTeamCount === 0 ? 'Enroll the first complete team to derive the shared roster size and round budget.' : 'One more complete team with the same roster size is required.' }}</p>
              <p v-else-if="isBattleSetup" class="bounded-note">Roster size and the {{ battleRoundBudget }}-round budget become immutable after this step.</p>
              <p v-else-if="projection.scoreboard.length < 3" class="bounded-note"><PhLockKey :size="17" /> Three through five contestants are required.</p>
              <p v-else-if="projection.participantVariantId === 'trainer-participant' && !projection.participantMethodId" class="bounded-note"><PhLockKey :size="17" /> Choose a Trainer Participant method.</p>
            </template>
            <p v-else class="empty-state">The GM is preparing the contestant lineup. This page will update when enrollment is locked.</p>
            <ContestPreparationWorkbench
              v-if="sheets.trainerSheets.length || sheets.pokemonSheets.length"
              :trainer-sheets="sheets.trainerSheets"
              :pokemon-sheets="sheets.pokemonSheets"
              :profile-id="profileId"
              @accepted="loadSheets"
            />
          </section>

          <section v-else-if="projection.stage === 'introduction'" class="action-panel" :class="{ 'battle-introduction-panel': isBattleIntroduction }" aria-labelledby="intro-title">
            <div class="panel-heading"><p>{{ isBattleIntroduction ? 'Trainer-team Introduction' : 'Introduction stage' }}</p><h2 id="intro-title" tabindex="-1" data-contest-primary>{{ isBattleIntroduction ? allIntroduced ? 'Both team pools are ready' : introductionActor ? `${introductionActor.displayName} makes an impression` : 'Battle Introductions in progress' : 'Make an impression' }}</h2></div>
            <section v-if="isBattleIntroduction" class="battle-intro-progress" aria-label="Battle Contest Introduction progress">
              <strong>{{ gmProjection ? `${battleIntroductionAcceptedCount} of 2 accepted` : ownerProjection?.ownContestant.introduction.status === 'accepted' ? 'Your team accepted' : 'Your team is pending' }}</strong>
              <span>{{ battleRosterSize }} Pokémon each</span><span>{{ battleRoundBudget }}-round budget</span><span>No Contest initiative</span>
            </section>
            <form v-if="introductionActor" class="intro-form" @submit.prevent="declareIntroduction">
              <p v-if="isBattleIntroduction"><strong>Choose one social Skill.</strong> Successes become shared Contest Stat Dice for any Pokémon on {{ introductionActor.displayName }}’s team. This roll does not set initiative.</p>
              <p v-else><strong>{{ introductionActor.displayName }}</strong> chooses one social Skill. Authority will roll <b>{{ introductionPreviewDice }}d6</b><template v-if="introductionBonusLabels.length"> ({{ introductionBonusLabels.join(', ') }})</template>.</p>
              <label><span>Introduction skill</span><select v-model="intro.skillId"><option v-for="skill in CONTEST_INTRODUCTION_SKILL_IDS" :key="skill" :value="skill">{{ pretty(skill) }} · {{ introductionActor.introductionSkillDice[skill] }}d6</option></select></label>
              <label><span>{{ isBattleIntroduction ? 'Generated team stat' : 'Skill-roll Contest stat' }}</span><select v-model="intro.generatedStatId"><option v-for="stat in introductionStatOptions" :key="stat" :value="stat">{{ pretty(stat) }}</option></select><small>{{ introductionHasGrace ? 'Grace allows any Contest stat.' : `${pretty(intro.skillId)} maps to ${pretty(introductionMappedStat)}.` }}<template v-if="!isBattleIntroduction"> Standard matching Appeal is determined by the selected Skill.</template></small></label>
              <label v-if="isBattleIntroduction" class="authority-preview"><span>Authority preview</span><output>Authority rolls {{ introductionPreviewDice }}d6</output><small>Pool custody: {{ introductionActor.displayName }}’s team · one shared pool.</small></label>
              <label v-if="introductionHasContestAccessory"><span>Contest Accessory roll stat</span><select v-model="intro.contestAccessoryStatId"><option v-for="stat in CONTEST_STAT_IDS" :key="stat" :value="stat">{{ pretty(stat) }}</option></select><small>This independent +2d6 roll may generate any one Contest stat.</small></label>
              <label v-if="introductionJugglingDice"><span>Juggling Show roll stat</span><select v-model="intro.jugglingShowStatId"><option v-for="stat in CONTEST_STAT_IDS" :key="stat" :value="stat">{{ pretty(stat) }}</option></select><small>This independent +{{ introductionJugglingDice }}d6 roll may generate any one Contest stat.</small></label>
              <button class="primary-action" :class="{ 'battle-intro-roll': isBattleIntroduction }" :disabled="projection.paused || runtime.submitting.value">{{ isBattleIntroduction ? 'Roll team Introduction' : 'Roll introduction' }}</button>
            </form>
            <p v-else-if="!isBattleIntroduction" class="empty-state"><PhCheckCircle :size="20" /> Your introduction is accepted. Waiting for the remaining contestants.</p>
            <template v-if="isBattleIntroduction">
              <div v-if="allContestants.length" class="battle-intro-team-grid" aria-label="Authorised Battle team pools">
                <article v-for="(team,index) in allContestants" :key="team.contestantId" class="battle-intro-team" :class="{ 'battle-intro-team--accepted': team.introduction.status === 'accepted' }">
                  <header><span class="battle-trainer-initial" aria-hidden="true">{{ team.displayName.slice(0,1) }}</span><span><small>Team {{ gmProjection ? index + 1 : 'yours' }} · {{ team.introduction.status }}</small><strong>{{ team.displayName }}</strong></span><PhCheckCircle v-if="team.introduction.status === 'accepted'" :size="24" weight="fill" aria-label="Introduction accepted" /></header>
                  <dl class="battle-pool-strip"><div v-for="stat in CONTEST_STAT_IDS" :key="stat" :class="{ 'has-dice': team.teamDicePools[stat].total > 0 }"><dt>{{ pretty(stat) }}</dt><dd>{{ team.teamDicePools[stat].remaining }}<template v-if="team.teamDicePools[stat].total">/{{ team.teamDicePools[stat].total }}</template></dd></div></dl>
                  <p v-if="team.introduction.status === 'accepted'"><strong>{{ pretty(team.introduction.skillId) }} · {{ team.introduction.skillRankDice + team.introduction.bonusDice }}d6 → {{ team.introduction.generatedDice }} generated</strong><span>{{ battleTeamPoolRemaining(team) }} of {{ battleTeamPoolTotal(team) }} team dice remain.</span></p>
                  <p v-else><strong>Introduction pending</strong><span>No team dice have been generated.</span></p>
                  <ul><li v-for="performer in contestantPokemon(team)" :key="performer.performerId"><span aria-hidden="true">{{ performer.displayName.slice(0,1) }}</span>{{ performer.displayName }}</li></ul>
                </article>
              </div>
              <p v-else class="empty-state">The Trainers are making their Introductions. Team pools and roll evidence remain visible only to their controller and the GM.</p>
              <p v-if="allIntroduced" class="battle-pools-secured"><PhCheckCircle :size="20" aria-hidden="true" /> 2 team pools secured · {{ gmProjection?.contestants.reduce((sum,team) => sum + battleTeamPoolTotal(team), 0) }} generated dice total · no initiative change</p>
              <div v-if="isGm && allIntroduced" class="battle-encounter-handoff battle-encounter-handoff--ready">
                <dl aria-label="Opening Encounter authority"><div><dt>Deployed</dt><dd>2 Trainers + 2 active Pokémon</dd></div><div><dt>Reserves</dt><dd>{{ Math.max(0, (battleRosterSize ?? 0) * 2 - 2) }} ready</dd></div><div><dt>Initiative</dt><dd>Round 1 · current Speed</dd></div></dl>
                <button type="button" class="primary-action" :disabled="projection.paused || runtime.submitting.value" @click="createBattleEncounter"><PhPulse :size="20" weight="bold" />{{ runtime.submitting.value ? 'Creating linked authority…' : 'Create & link Battle encounter' }}</button>
                <small>Map, Encounter, Scene, opening deployment, initiative, and Contest link commit together or not at all.</small>
              </div>
              <p v-else-if="allIntroduced" class="bounded-note"><PhLockKey :size="17" /> The GM is creating the linked Battle encounter.</p>
            </template>
            <div v-else class="accepted-grid"><article v-for="row in projection.scoreboard" :key="row.contestantId"><strong>{{ row.displayName }}</strong><span v-if="allContestants.find(item => item.contestantId === row.contestantId)?.introduction.status === 'accepted'">Accepted · Letter {{ row.letter ?? 'pending tie resolution' }}</span><span v-else>Waiting</span></article></div>
            <div v-if="isGm" class="button-row"><button type="button" class="quiet-action" @click="stageCommand('restart-introduction')">Restart introductions</button><button v-if="!isBattleIntroduction" type="button" class="primary-action" :disabled="!allIntroduced || projection.paused || runtime.submitting.value" @click="stageCommand('start-performance')">Start performance</button></div>
          </section>

          <section v-else-if="isBattlePerformance" class="action-panel battle-linked-panel" aria-labelledby="battle-linked-title">
            <div class="battle-linked-heading"><PhCheckCircle :size="46" weight="duotone" aria-hidden="true" /><div><p>Encounter link accepted</p><h2 id="battle-linked-title" tabindex="-1" data-contest-primary>Battle encounter linked</h2><span>Continue in Live Encounter. Placement, initiative, turns, and battle results remain Encounter authority.</span></div></div>
            <dl class="battle-linked-facts" aria-label="Accepted opening Encounter facts"><div><dt>Opening field</dt><dd>{{ battleEncounter?.deployedCount }} deployed</dd></div><div><dt>Reserves</dt><dd>{{ battleEncounter?.readyReserveCount }} ready</dd></div><div><dt>Initiative</dt><dd>Round {{ battleEncounter?.openingRound }} · Speed-derived</dd></div></dl>
            <NuxtLink class="primary-action battle-open-encounter" :to="battleEncounterPath"><PhPulse :size="21" weight="bold" />Open live encounter</NuxtLink>
            <p class="battle-scoring-wait"><PhLockKey :size="17" aria-hidden="true" /> Contest scoring is waiting for accepted encounter results.</p>
            <section class="battle-linked-pools" aria-labelledby="battle-pools-title"><header><div><p>Team continuity</p><h3 id="battle-pools-title">Trainer-team pools remain secured</h3></div><strong>No Contest initiative</strong></header>
              <div v-if="allContestants.length" class="battle-intro-team-grid">
                <article v-for="(team,index) in allContestants" :key="team.contestantId" class="battle-intro-team battle-intro-team--accepted">
                  <header><span class="battle-trainer-initial" aria-hidden="true">{{ team.displayName.slice(0,1) }}</span><span><small>Team {{ gmProjection ? index + 1 : 'yours' }} · linked</small><strong>{{ team.displayName }}</strong></span><PhCheckCircle :size="24" weight="fill" aria-label="Team authority linked" /></header>
                  <dl class="battle-pool-strip"><div v-for="stat in CONTEST_STAT_IDS" :key="stat" :class="{ 'has-dice': team.teamDicePools[stat].total > 0 }"><dt>{{ pretty(stat) }}</dt><dd>{{ team.teamDicePools[stat].remaining }}<template v-if="team.teamDicePools[stat].total">/{{ team.teamDicePools[stat].total }}</template></dd></div></dl>
                  <p><strong>{{ pretty(team.introduction.skillId) }} · {{ team.introduction.skillRankDice + team.introduction.bonusDice }}d6 → {{ team.introduction.generatedDice }} generated</strong><span>{{ battleTeamPoolRemaining(team) }} of {{ battleTeamPoolTotal(team) }} team dice remain.</span></p>
                  <ul><li v-for="(performer,memberIndex) in contestantPokemon(team)" :key="performer.performerId"><span aria-hidden="true">{{ performer.displayName.slice(0,1) }}</span>{{ performer.displayName }}<small v-if="memberIndex === 0">opening active</small><small v-else>reserve</small></li></ul>
                </article>
              </div>
              <p v-else class="empty-state">The two accepted team pools remain private to their controllers. Public Battle state continues in the linked encounter.</p>
            </section>
          </section>

          <section v-else-if="projection.stage === 'performance'" class="action-panel appeal-panel" aria-labelledby="appeal-title">
            <div class="panel-heading"><p>{{ activeContestant?.displayName ?? 'Current contestant' }}</p><h2 id="appeal-title" tabindex="-1" data-contest-primary>{{ canControlActive ? 'Your appeal' : 'Appeal in progress' }}</h2><span v-if="projection.paused" class="paused-chip">Paused by GM</span></div>
            <div v-if="canControlActive && projection.variantId === 'rotation' && !activePerformer" class="rotation-performer-choice">
              <p><strong>Choose this round’s performer.</strong> The choice locks when authority accepts it; every team Pokémon may appear only once.</p>
              <button v-for="performer in availableRotationPerformers" :key="performer.performerId" type="button" class="quiet-action" :disabled="runtime.submitting.value" @click="selectRotationPerformer(performer.performerId)">{{ performer.displayName }} · {{ performer.species }}</button>
            </div>
            <template v-else-if="canControlActive">
              <fieldset v-if="projection.participantVariantId === 'trainer-participant' && participantLegalPerformers.length && !pendingAppeal" class="participant-performer-choice" :disabled="projection.paused || runtime.submitting.value">
                <legend>{{ participantChoiceHeading }}</legend>
                <button v-for="performer in participantLegalPerformers" :key="performer.performerId" type="button" :class="{ selected: appeal.performerId === performer.performerId }" :aria-pressed="appeal.performerId === performer.performerId" @click="selectParticipantPerformer(performer.performerId)">
                  <span class="participant-kind">{{ contestPerformerIsTrainer(performer) ? 'Trainer' : 'Pokémon' }}</span><strong>{{ performer.displayName }}</strong><small>Voltage <b>{{ performerVoltage(performer) }}</b></small><em v-if="appeal.performerId === performer.performerId"><PhCheckCircle :size="18" aria-hidden="true" /> Selected</em>
                </button>
              </fieldset>
              <template v-if="activePerformer">
              <p class="active-performer"><strong>{{ activePerformer.displayName }}</strong> · {{ contestPerformerIsPokemon(activePerformer) ? activePerformer.species : 'Trainer' }} · Voltage {{ activeVoltage }} <span v-if="activeScore?.position?.centerOfAttention">· Center of attention</span></p>
              <div v-if="projection.pendingInterventionAppealId && pendingAppeal" class="reroll-decision">
                <PhCheckCircle :size="36" weight="duotone" aria-hidden="true" />
                <div><p>Appeal accepted · reroll window</p><h3>{{ pendingAppeal.moveLabel }} · {{ pendingAppeal.acceptedResults.join(', ') }}</h3><small>The score is authoritative. Use one offered reroll or explicitly pass before turn advancement.</small></div>
                <label v-if="postOfferedInterventions.length"><span>Offered reroll</span><select v-model="intervention.id"><option value="">Choose</option><option v-for="name in postOfferedInterventions" :key="name" :value="name">{{ name }}</option></select></label>
                <p v-if="intervention.id === 'Coordinator'" class="bounded-note">Coordinator rerolls the entire accepted Appeal Roll.</p>
                <div class="button-row"><button v-if="postOfferedInterventions.length" type="button" class="primary-action" :disabled="!interventionReady || projection.paused || runtime.submitting.value" @click="useIntervention">Reroll and accept</button><button type="button" class="quiet-action" :disabled="projection.paused || runtime.submitting.value" @click="passIntervention">Keep result and continue</button></div>
              </div>
              <template v-else>
              <fieldset class="move-options" :disabled="projection.paused || runtime.submitting.value"><legend>Choose a Move</legend><label v-for="move in activePerformer.moves" :key="move.optionId" :class="{ selected: appeal.moveOptionId === move.optionId, unavailable: Boolean(moveDecisionReason(move)) }"><input v-model="appeal.moveOptionId" type="radio" :value="move.optionId" :disabled="Boolean(moveDecisionReason(move))" /><span><strong>{{ move.label }}</strong><small v-if="!moveDecisionReason(move)">{{ pretty(move.typeId) }} · {{ pretty(move.effectId) }}</small><small v-else><PhLockKey :size="14" />{{ moveDecisionReason(move) }}</small></span></label></fieldset>
              <label v-if="partnerEffectPerformer" class="partner-effect-choice"><input v-model="appeal.partnerEffectTargetPerformerId" type="checkbox" :true-value="partnerEffectPerformer.performerId" false-value="" /><span><strong>Apply {{ pretty(effectiveAppealEffectId) }} to partner</strong><small>{{ partnerEffectPerformer.displayName }} receives the reviewed same-turn paired effect.</small></span></label>
              <fieldset class="dice-pools" :disabled="projection.paused || runtime.submitting.value"><legend>{{ projection.participantVariantId === 'trainer-participant' ? 'Shared Contest dice' : `Spend up to ${contestCatalog.performance.contestDiceSpendMaximumPerAppeal} Contest dice` }} <template v-if="projection.participantVariantId === 'trainer-participant'">· spend up to {{ contestCatalog.performance.contestDiceSpendMaximumPerAppeal }}</template><template v-if="rotationTeamRemaining !== null">· {{ rotationTeamRemaining }} remain for this Rotation team</template></legend><div v-for="stat in CONTEST_STAT_IDS" :key="stat" class="pool-control"><span>{{ pretty(stat) }}<small>{{ activePoolRemaining(stat) }} remain</small></span><div><button type="button" :aria-label="`Spend one fewer ${stat} die`" @click="setSpend(stat,-1)">−</button><output :aria-label="`${appeal.spent[stat]} ${stat} dice selected`">{{ appeal.spent[stat] }}</output><button type="button" :aria-label="`Spend one more ${stat} die`" @click="setSpend(stat,1)">+</button></div></div></fieldset>
              <div class="assembled-roll"><strong>Assembled roll</strong><p v-if="selectedMove"><span>{{ appealAssembly?.baseDice ?? 0 }} effect</span><b>+</b><span>{{ relationship?.dice ?? 0 }} alignment</span><b>+</b><span>{{ spentTotal }} spent</span><b>+</b><span>{{ appealAssembly?.voltageDice ?? 0 }} Voltage</span><template v-if="appealAssembly?.voiceDice"><b>+</b><span>{{ appealAssembly.voiceDice }} Voice Lessons</span></template><template v-if="appealAssembly?.interventionDice"><b>+</b><span>{{ appealAssembly.interventionDice }} intervention</span></template><b>=</b><span>{{ roughAssembled ?? 'authority-resolved' }}d6</span></p><p v-else>Choose an available Move to preview the authoritative inputs.</p><small>The shared canonical assembler includes dynamic effects, Voltage, alignment, accepted interventions, and active providers; the server verifies the same inputs on submit.</small></div>
              <button type="button" class="submit-appeal" :disabled="!appeal.moveOptionId || projection.paused || runtime.submitting.value" @click="submitAppeal"><PhPulse :size="24" weight="bold" />{{ runtime.submitting.value ? 'Awaiting authority…' : 'Submit appeal' }}</button>

              <details v-if="preOfferedInterventions.length" class="intervention-panel"><summary>Contest interventions ({{ preOfferedInterventions.length }} available)</summary><div class="intervention-form"><label><span>Intervention</span><select v-model="intervention.id"><option value="">Choose an offered action</option><option v-for="name in preOfferedInterventions" :key="name" :value="name">{{ name }}</option></select></label><template v-if="intervention.id === 'Adaptable Performance'"><label><span>Type from Move</span><select v-model="intervention.typeMoveOptionId"><option value="">Choose an available Move</option><option v-for="move in activePerformer.moves.filter(row => row.available)" :key="move.optionId" :value="move.optionId">{{ move.label }} · {{ pretty(move.typeId) }}</option></select></label><label><span>Effect from a different Move</span><select v-model="intervention.effectMoveOptionId"><option value="">Choose an available Move</option><option v-for="move in activePerformer.moves.filter(row => row.available && row.optionId !== intervention.typeMoveOptionId)" :key="move.optionId" :value="move.optionId">{{ move.label }} · {{ pretty(move.effectId) }}</option></select></label></template><button type="button" class="quiet-action" :disabled="!interventionReady || projection.paused || runtime.submitting.value" @click="useIntervention">Apply intervention</button></div></details>
              </template>
              </template>
              <div v-else class="participant-choice-empty"><PhPulse :size="28" aria-hidden="true" /><p>Choose the Trainer or Pokémon to reveal that performer’s legal Move offers.</p></div>
            </template>
            <div v-else class="watch-state"><PhPulse :size="32" aria-hidden="true" /><p><strong>{{ activeContestant?.displayName ?? 'Authority' }}</strong> is choosing an appeal.</p><small>Private Move offers and dice pools remain visible only to that controller and the GM.</small></div>
          </section>

          <section v-else-if="projection.stage === 'settling'" class="action-panel" aria-labelledby="settle-title"><div class="panel-heading"><p>Performance complete</p><h2 id="settle-title" tabindex="-1" data-contest-primary>Settlement</h2></div><p>Review final placements, experience, ribbons, money, and prizes before one atomic commit.</p><div v-if="isGm && gmProjection && !gmProjection.policy.prize.declared" class="undeclared-prize"><strong>Guided prize decision required</strong><p>The saved private package contains ₽{{ gmProjection.policy.prize.money.toLocaleString() }} and {{ gmProjection.policy.prize.items.length }} item write{{ gmProjection.policy.prize.items.length === 1 ? '' : 's' }}. Declare it—even when empty—before preparing settlement.</p><button type="button" class="primary-action" :disabled="projection.paused || runtime.submitting.value" @click="stageCommand('declare-prize')">Declare saved prize package</button></div><p v-else-if="!projection.declaredPrize && !projection.settlement" class="empty-state">The GM is completing the guided prize decision.</p><button v-if="isGm && !projection.settlement && gmProjection?.policy.prize.declared" class="primary-action" :disabled="projection.paused || runtime.submitting.value" @click="stageCommand('prepare-settlement')">Prepare settlement preview</button><div v-if="projection.settlement" class="settlement-list"><article v-for="entry in projection.settlement.entries" :key="entry.contestantId"><b>#{{ entry.placement }}</b><span><strong>{{ projection.scoreboard.find(row => row.contestantId === entry.contestantId)?.displayName }}</strong><small>{{ entry.experienceByPokemon.map((row, index) => `${settlementPokemonLabel(entry.contestantId, index, entry.experienceByPokemon.length)} +${row.experience} EXP`).join(' · ') }}</small></span><em v-if="entry.ribbon">Ribbon</em></article><p>Prize money: ₽{{ projection.settlement.money.toLocaleString() }}</p><ul v-if="projection.settlement.items.length" class="settlement-prizes"><li v-for="(item,index) in projection.settlement.items" :key="`${item.itemId}:${item.targetContestantId ?? 'winner'}:${index}`"><strong>{{ item.quantity }}× {{ item.itemId }}</strong> → {{ settlementPrizeTargetLabel(item.targetContestantId) }}</li></ul><p v-if="projection.settlement.attentionItemCount" class="bounded-note">{{ projection.settlement.attentionItemCount }} progression review{{ projection.settlement.attentionItemCount === 1 ? '' : 's' }} will hand off to ordinary campaign attention.</p></div><button v-if="isGm && projection.settlement?.status === 'preview'" class="primary-action" :disabled="projection.paused || runtime.submitting.value" @click="stageCommand('commit-settlement')">Commit settlement atomically</button></section>

          <section v-else-if="projection.stage === 'completed'" class="action-panel completion-panel"><PhCheckCircle :size="48" weight="duotone" /><div><p>Contest completed</p><h2 tabindex="-1" data-contest-primary>Results are committed</h2><p>Experience, ribbon provenance, and declared prizes have been written to their ordinary campaign sheets.</p></div></section>
          <section v-else-if="projection.stage === 'cancelled'" class="action-panel"><div class="panel-heading"><p>Cancelled</p><h2 tabindex="-1" data-contest-primary>{{ projection.cancellationReason }}</h2></div><p>The journal and public history remain available as recovery evidence.</p></section>
        </div>

        <aside class="secondary-column">
          <section v-if="isBattlePerformance" class="score-panel battle-linked-teams"><div class="panel-heading"><p>Accepted rosters</p><h2>Battle teams</h2></div><article v-for="(row,index) in projection.scoreboard" :key="row.contestantId"><header><span class="battle-trainer-initial" aria-hidden="true">{{ row.displayName.slice(0,1) }}</span><span><small>Team {{ index + 1 }} · linked</small><strong>{{ row.displayName }}</strong></span><PhCheckCircle :size="20" weight="fill" aria-label="Linked" /></header><ul><li v-for="(performer,memberIndex) in row.performers" :key="`${performer.displayName}:${memberIndex}`"><span class="battle-roster-portrait" aria-hidden="true">{{ performer.displayName.slice(0,1) }}</span><span><strong>{{ performer.displayName }}</strong><small>{{ memberIndex === 0 ? 'Opening active' : 'Ready reserve' }}</small></span></li></ul></article></section>
          <section v-else class="score-panel"><div class="panel-heading"><p>Live authority</p><h2>Scoreboard</h2></div><div class="score-table" role="table" aria-label="Contest scores" tabindex="0"><div class="score-head" role="row"><span role="columnheader">Entry</span><span role="columnheader">Appeal</span><span role="columnheader">Fumble</span><span role="columnheader">Score</span><span role="columnheader">Voltage</span></div><div v-for="row in [...projection.scoreboard].sort((a,b) => (a.placement ?? 99)-(b.placement ?? 99) || b.finalScore-a.finalScore)" :key="row.contestantId" class="score-row" role="row"><span role="cell"><b v-if="row.placement">#{{ row.placement }}&nbsp;</b>{{ row.displayName }}<small>{{ row.performers.map(member => member.displayName).join(' + ') || row.pokemonName }}</small></span><span role="cell">{{ row.appeal }}</span><span role="cell">{{ row.fumble }}</span><strong role="cell">{{ row.finalScore }}</strong><span role="cell" class="score-voltage"><template v-if="projection.participantMethodId === 'simultaneous'"><small v-for="member in row.performers" :key="member.performerKind"><b>{{ member.performerKind === 'trainer' ? 'T' : 'P' }}</b> {{ member.voltage }}</small></template><template v-else>{{ row.voltage }}</template></span></div></div></section>

          <section v-if="isBattlePerformance" class="results-panel battle-linked-summary"><div class="panel-heading"><p>Existing Encounter authority</p><h2>Linked encounter</h2></div><dl><div><dt>Battlefield</dt><dd>{{ projection.display.name }} — Battle</dd></div><div><dt>Status</dt><dd>Live Encounter active</dd></div><div><dt>Initiative</dt><dd>Round {{ battleEncounter?.openingRound }} ready</dd></div><div><dt>Roster</dt><dd>{{ battleEncounter?.deployedCount }} deployed · {{ battleEncounter?.readyReserveCount }} reserves</dd></div></dl><NuxtLink class="quiet-action" :to="battleEncounterPath">Open encounter cockpit</NuxtLink></section>

          <section v-else class="results-panel"><div class="panel-heading"><p>Immutable journal</p><h2>Accepted results</h2></div><p v-if="!projection.acceptedAppeals.length" class="empty-state">Accepted appeals will appear here.</p><details v-for="entry in [...projection.acceptedAppeals].reverse()" :key="entry.appealId" class="result-row"><summary><PhCheckCircle :size="22" /><span><strong>Round {{ entry.round }} · {{ projection.scoreboard.find(row => row.contestantId === entry.contestantId)?.displayName }}</strong><small>{{ entry.moveLabel }} · {{ entry.assembledDice }}d6</small></span><em>Inspect roll</em></summary><div><p class="dice-results"><b v-for="(die,index) in entry.acceptedResults" :key="index">{{ die }}</b></p><ul><li v-for="(source,index) in entry.contributors" :key="`${source.kind}:${source.label}:${index}`"><strong>{{ source.dice >= 0 ? '+' : '' }}{{ source.dice }}d6</strong> {{ source.explanation }}</li></ul><p>Accepted: +{{ entry.appealDelta }} Appeal, +{{ entry.fumbleDelta }} Fumble, Voltage {{ entry.voltageBefore }} → {{ entry.voltageAfter }}</p></div></details></section>

          <details v-if="isGm && projection.variantId !== 'battle' && !['completed','cancelled'].includes(projection.stage)" class="gm-tools"><summary>GM corrections and recovery</summary><form @submit.prevent="applyCorrection"><label><span>Correction</span><select v-model="correction.kind"><option value="appeal-delta">Appeal delta</option><option value="fumble-delta">Fumble delta</option><option value="voltage-delta">Voltage delta</option><option value="dice-pool-delta">Contest pool delta</option><option value="controller-reassignment">Controller reassignment</option></select></label><label><span>Contestant</span><select v-model="correction.contestantId" required><option value="">Choose</option><option v-for="row in gmProjection?.contestants" :key="row.contestantId" :value="row.contestantId">{{ row.displayName }}</option></select></label><label v-if="correction.kind === 'dice-pool-delta'"><span>Pool</span><select v-model="correction.statId"><option v-for="stat in CONTEST_STAT_IDS" :key="stat" :value="stat">{{ pretty(stat) }}</option></select></label><label v-if="correction.kind !== 'controller-reassignment'"><span>Numeric delta</span><input v-model.number="correction.numericDelta" type="number" :min="-contestCatalog.corrections.maximumAbsoluteNumericDelta" :max="contestCatalog.corrections.maximumAbsoluteNumericDelta" /></label><label v-else><span>Replacement profile</span><select v-model="correction.replacementProfileId"><option value="">GM control</option><option v-for="profile in profileOptions" :key="profile.id" :value="profile.id">{{ profile.displayName }}</option></select></label><label><span>Reason (journaled)</span><textarea v-model.trim="correction.reason" required maxlength="500" rows="3" /></label><button class="quiet-action">Apply correction</button></form><hr /><form @submit.prevent="cancelContest"><label><span>Cancellation reason</span><input v-model.trim="cancelReason" required maxlength="500" /></label><button class="danger-action">Cancel Contest</button></form></details>
        </aside>
      </div>
    </template>
  </main>
</template>

<style scoped>
.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}.contest-cockpit{min-height:100dvh;padding:clamp(.65rem,1.5vw,1.35rem);background:var(--rt-bg-canvas,var(--paper));color:var(--rt-text,var(--ink));}.contest-cockpit>*{width:min(100%,112rem);margin-inline:auto}.contest-header{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:1rem;padding:1rem 0 1.2rem;border-bottom:1px solid var(--rt-rule,var(--rule-soft))}.back-link{display:inline-flex;align-items:center;gap:.4rem;color:var(--rt-text-muted,var(--ink-muted));text-decoration:none}.contest-heading{text-align:center}.contest-heading>p,.panel-heading>p{margin:0 0 .2rem;color:var(--rt-pending,var(--warn));font-size:.7rem;font-weight:900;letter-spacing:.11em;text-transform:uppercase}.contest-heading h1{margin:0;color:var(--rt-text-strong,var(--ink-bright));font:700 clamp(2rem,4vw,3.5rem)/1 var(--font-book)}.header-meta{display:flex;justify-content:center;flex-wrap:wrap;gap:.35rem;margin-top:.6rem}.header-meta span,.paused-chip{border:1px solid var(--rt-rule,var(--rule-soft));padding:.22rem .5rem;font-size:.68rem;font-weight:850;text-transform:uppercase}.pause-action{justify-self:end}.pause-action,.quiet-action,.primary-action,.danger-action,.icon-action,.submit-appeal,.pool-control button{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;min-height:44px;border:1px solid var(--rt-rule,var(--rule-soft));background:transparent;color:var(--rt-text,var(--ink));padding:.65rem .9rem;font-weight:850;cursor:pointer}.primary-action,.submit-appeal{border-color:var(--rt-brand,var(--accent));background:var(--rt-brand,var(--accent));color:var(--rt-bg-world,var(--ink))}.danger-action{border-color:var(--rt-danger,var(--bad));color:var(--rt-danger,var(--bad))}.message{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem;margin-block:1rem;padding:.8rem 1rem;border:1px solid}.message--error{border-color:var(--rt-danger,var(--bad));color:var(--rt-danger,var(--bad))}.message--accepted{border-color:var(--rt-success,var(--good));color:var(--rt-success,var(--good))}.loading-state,.empty-state{padding:1.2rem;color:var(--rt-text-muted,var(--ink-muted))}.stage-line{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:.7rem;padding:1rem 0}.performer-card{display:grid;grid-template-columns:78px minmax(0,1fr) auto;gap:.65rem;align-items:center;padding:.6rem;border:1px solid var(--rt-rule,var(--rule-soft));background:var(--rt-surface-1,var(--paper-soft))}.performer-card--active{border:2px solid var(--rt-pending,var(--warn));box-shadow:inset 0 -3px var(--rt-focus,var(--info))}.pair-portraits{display:flex;align-items:center;width:78px}.pair-portraits img,.pair-portraits .portrait-fallback{width:48px;height:56px;flex:0 0 48px}.pair-portraits>*+*{margin-left:-18px}.performer-card img,.portrait-fallback{width:64px;height:64px;object-fit:contain;border:1px solid var(--rt-rule,var(--rule-soft));background:var(--rt-bg-canvas,var(--paper-inset))}.portrait-fallback{display:grid;place-items:center;font:800 1.35rem var(--font-mono)}.performer-card>div,.score-row>span{min-width:0;overflow-wrap:anywhere}.performer-card strong,.performer-card small,.performer-card em{display:block}.performer-card em{color:var(--rt-pending,var(--warn));font-size:.68rem;font-style:normal}.performer-card>b{align-self:start;font:800 1.5rem var(--font-mono);color:var(--rt-text-muted,var(--ink-muted))}.performer-card dl{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,1fr);margin:0;border-top:1px solid var(--rt-rule,var(--rule-soft));padding-top:.5rem}.performer-card dl div{display:flex;justify-content:space-between;padding-inline:.35rem;border-right:1px solid var(--rt-rule,var(--rule-soft))}.performer-card dt{font-size:.65rem;color:var(--rt-text-muted,var(--ink-muted))}.performer-card dd{display:flex;gap:.4rem;margin:0;font:700 .9rem var(--font-mono)}.cockpit-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(23rem,1fr);gap:1rem;align-items:start}.primary-column,.secondary-column{display:grid;gap:1rem;min-width:0}.action-panel,.score-panel,.results-panel,.gm-tools{min-width:0;border:1px solid var(--rt-rule,var(--rule-soft));background:var(--rt-surface-1,var(--paper-soft));padding:clamp(1rem,2vw,1.5rem)}.action-panel{border-left:3px solid var(--rt-pending,var(--warn))}.panel-heading{position:relative;margin-bottom:1rem}.panel-heading h2{margin:0;color:var(--rt-text-strong,var(--ink-bright));font:700 1.65rem/1 var(--font-book)}.paused-chip{position:absolute;right:0;top:0;color:var(--rt-danger,var(--bad))}label{display:grid;gap:.35rem;color:var(--rt-text-muted,var(--ink-muted));font-size:.75rem;font-weight:850;letter-spacing:.03em}select,input,textarea{width:100%;min-height:44px;border:1px solid var(--rt-rule,var(--rule-soft));background:var(--rt-bg-canvas,var(--paper-inset));color:var(--rt-text-strong,var(--ink-bright));padding:.65rem .7rem}.method-policy{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem;margin:0 0 1rem;padding:.8rem;border:1px solid var(--rt-rule,var(--rule-soft));}.method-policy legend{padding-inline:.3rem;color:var(--rt-text-strong,var(--ink-bright));font-weight:850}.method-policy p{grid-column:1/-1;margin:0;color:var(--rt-text-muted,var(--ink-muted));line-height:1.45}.battle-setup-progress{display:grid;gap:.8rem;margin-bottom:1rem;border:1px solid var(--rt-pending,var(--warn));background:var(--rt-bg-canvas,var(--paper-inset));padding:.8rem 1rem}.battle-setup-progress>div{display:flex;align-items:baseline;justify-content:space-between;gap:1rem}.battle-setup-progress>div strong{color:var(--rt-pending,var(--warn));font-size:1.05rem}.battle-setup-progress>div span{color:var(--rt-text-muted,var(--ink-muted));font-size:.82rem}.battle-setup-progress dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0;border-top:1px solid var(--rt-rule,var(--rule-soft));padding-top:.65rem}.battle-setup-progress dl div{display:grid;gap:.2rem;padding-inline:.55rem;border-right:1px solid var(--rt-rule,var(--rule-soft))}.battle-setup-progress dl div:last-child{border-right:0}.battle-setup-progress dt{color:var(--rt-text-muted,var(--ink-muted));font-size:.68rem;font-weight:850;text-transform:uppercase}.battle-setup-progress dd{margin:0;color:var(--rt-text-strong,var(--ink-bright));font:750 .95rem var(--font-mono)}.battle-setup-instruction{border-left:3px solid var(--rt-pending,var(--warn));padding:.65rem .8rem;color:var(--rt-text-muted,var(--ink-muted));background:var(--rt-bg-canvas,var(--paper-inset))}.enrollment-form,.intro-form,.intervention-form,.gm-tools form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.8rem;align-items:end}.intro-form>p{grid-column:1/-1}.battle-team-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;list-style:none;padding:0;margin:1rem 0}.battle-team-card{min-width:0;border:1px solid var(--rt-rule,var(--rule-soft));border-left:3px solid var(--rt-success,var(--good));background:var(--rt-bg-canvas,var(--paper-inset));padding:.75rem}.battle-team-card header{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding-bottom:.6rem;border-bottom:1px solid var(--rt-rule,var(--rule-soft))}.battle-team-card header small,.battle-team-card header strong,.battle-team-card header em{display:block}.battle-team-card header small{color:var(--rt-success,var(--good));font-size:.68rem;font-weight:900;letter-spacing:.07em;text-transform:uppercase}.battle-team-card header strong{color:var(--rt-text-strong,var(--ink-bright));font-size:1.15rem}.battle-team-card header em{color:var(--rt-text-muted,var(--ink-muted));font-size:.72rem;font-style:normal}.battle-team-card ol{display:grid;gap:.35rem;list-style:none;padding:0;margin:.65rem 0 0}.battle-team-card ol li{display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:center;gap:.55rem;min-height:44px;border:1px solid var(--rt-rule,var(--rule-soft));padding:.25rem .45rem}.battle-team-card ol li>svg{color:var(--rt-success,var(--good))}.battle-roster-portrait{display:grid;place-items:center;width:34px;height:34px;border:1px solid var(--rt-rule,var(--rule-soft));background:var(--rt-surface-2,var(--paper-soft));font:800 .85rem var(--font-mono)}.battle-introduction-panel{border-left-color:var(--rt-info,var(--info))}.battle-intro-progress{display:grid;grid-template-columns:minmax(12rem,1.4fr) repeat(3,minmax(8rem,1fr));align-items:center;margin:0 0 1rem;border:1px solid var(--rt-rule,var(--rule-soft));background:var(--rt-bg-canvas,var(--paper-inset))}.battle-intro-progress>*{min-width:0;padding:.7rem .8rem;border-right:1px solid var(--rt-rule,var(--rule-soft));text-align:center}.battle-intro-progress>*:last-child{border-right:0}.battle-intro-progress strong{color:var(--rt-info,var(--info))}.battle-intro-progress span{color:var(--rt-text-muted,var(--ink-muted));font-size:.78rem;font-weight:850}.authority-preview output{display:flex;align-items:center;min-height:44px;border:1px solid var(--rt-rule,var(--rule-soft));background:var(--rt-bg-canvas,var(--paper-inset));color:var(--rt-text-strong,var(--ink-bright));padding:.65rem .7rem;font:750 .9rem var(--font-mono)}.battle-intro-roll{grid-column:1/-1;width:100%;font-size:1.05rem}.battle-intro-team-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;margin:1rem 0}.battle-intro-team{min-width:0;border:1px solid var(--rt-rule,var(--rule-soft));border-left:4px solid var(--rt-pending,var(--warn));background:var(--rt-bg-canvas,var(--paper-inset));padding:.75rem}.battle-intro-team--accepted{border-left-color:var(--rt-success,var(--good))}.battle-intro-team header{display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:.65rem;padding-bottom:.65rem;border-bottom:1px solid var(--rt-rule,var(--rule-soft))}.battle-intro-team header>svg{color:var(--rt-success,var(--good))}.battle-intro-team header small,.battle-intro-team header strong{display:block}.battle-intro-team header small{color:var(--rt-text-muted,var(--ink-muted));font-size:.65rem;font-weight:900;letter-spacing:.06em;text-transform:uppercase}.battle-intro-team header strong{color:var(--rt-text-strong,var(--ink-bright));font-size:1.08rem}.battle-trainer-initial{display:grid;place-items:center;width:42px;height:42px;border:1px solid var(--rt-rule,var(--rule-soft));font:850 1.15rem var(--font-mono)}.battle-pool-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin:.7rem 0;border:1px solid var(--rt-rule,var(--rule-soft))}.battle-pool-strip div{min-width:0;padding:.48rem .2rem;border-right:1px solid var(--rt-rule,var(--rule-soft));text-align:center}.battle-pool-strip div:last-child{border-right:0}.battle-pool-strip dt{overflow:hidden;color:var(--rt-text-muted,var(--ink-muted));font-size:.6rem;font-weight:850;text-overflow:ellipsis}.battle-pool-strip dd{margin:.2rem 0 0;font:800 1rem var(--font-mono)}.battle-pool-strip .has-dice{box-shadow:inset 0 -3px var(--rt-success,var(--good))}.battle-pool-strip .has-dice dd{color:var(--rt-success,var(--good))}.battle-intro-team>p{display:grid;gap:.2rem;margin:.6rem 0;color:var(--rt-text-muted,var(--ink-muted));font-size:.72rem}.battle-intro-team>p strong{color:var(--rt-text-strong,var(--ink-bright))}.battle-intro-team ul{display:flex;flex-wrap:wrap;gap:.35rem;list-style:none;padding:0;margin:.6rem 0 0}.battle-intro-team li{display:flex;align-items:center;gap:.3rem;min-width:0;border:1px solid var(--rt-rule,var(--rule-soft));padding:.25rem .4rem;font-size:.7rem}.battle-intro-team li span{display:grid;place-items:center;width:24px;height:24px;background:var(--rt-surface-2,var(--paper-soft));font:800 .65rem var(--font-mono)}.battle-pools-secured{display:flex;align-items:center;justify-content:center;gap:.45rem;color:var(--rt-success,var(--good));font-weight:850;text-align:center}.battle-encounter-handoff{display:grid;gap:.55rem;margin:.8rem 0;text-align:center}.battle-encounter-handoff button{width:100%}.battle-encounter-handoff>small{color:var(--rt-text-muted,var(--ink-muted))}.battle-encounter-handoff--ready{border:1px solid var(--rt-rule,var(--rule-soft));background:var(--rt-bg-canvas,var(--paper-inset));padding:.8rem}.battle-encounter-handoff--ready dl,.battle-linked-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:0;border:1px solid var(--rt-rule,var(--rule-soft))}.battle-encounter-handoff--ready dl div,.battle-linked-facts div{min-width:0;padding:.6rem;border-right:1px solid var(--rt-rule,var(--rule-soft));text-align:left}.battle-encounter-handoff--ready dl div:last-child,.battle-linked-facts div:last-child{border-right:0}.battle-encounter-handoff dt,.battle-linked-facts dt{color:var(--rt-text-muted,var(--ink-muted));font-size:.65rem;font-weight:850;text-transform:uppercase}.battle-encounter-handoff dd,.battle-linked-facts dd{margin:.2rem 0 0;color:var(--rt-text-strong,var(--ink-bright));font:750 .82rem var(--font-mono)}.battle-linked-panel{border-left-color:var(--rt-success,var(--good))}.battle-linked-heading{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:.85rem}.battle-linked-heading>svg{color:var(--rt-success,var(--good))}.battle-linked-heading p,.battle-linked-pools>header p{margin:0;color:var(--rt-success,var(--good));font-size:.68rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.battle-linked-heading h2{margin:.15rem 0;color:var(--rt-text-strong,var(--ink-bright));font:700 clamp(1.7rem,3vw,2.4rem)/1 var(--font-book)}.battle-linked-heading span{color:var(--rt-text-muted,var(--ink-muted));line-height:1.45}.battle-linked-facts{margin:1rem 0}.battle-open-encounter{width:100%;min-height:52px;text-decoration:none}.battle-scoring-wait{display:flex;align-items:center;justify-content:center;gap:.4rem;color:var(--rt-text-muted,var(--ink-muted));text-align:center}.battle-linked-pools{margin-top:1.2rem;border-top:1px solid var(--rt-rule,var(--rule-soft));padding-top:1rem}.battle-linked-pools>header{display:flex;align-items:end;justify-content:space-between;gap:1rem}.battle-linked-pools>header h3{margin:.15rem 0 0;color:var(--rt-text-strong,var(--ink-bright));font:700 1.25rem var(--font-book)}.battle-linked-pools>header>strong{color:var(--rt-success,var(--good));font-size:.72rem}.battle-linked-pools .battle-intro-team li{flex:1 1 8rem}.battle-linked-pools .battle-intro-team li small{margin-left:auto;color:var(--rt-text-muted,var(--ink-muted));font-size:.62rem}.battle-linked-teams{display:grid;gap:.65rem}.battle-linked-teams>.panel-heading{margin-bottom:.25rem}.battle-linked-teams>article{border:1px solid var(--rt-rule,var(--rule-soft));background:var(--rt-bg-canvas,var(--paper-inset));padding:.7rem}.battle-linked-teams>article>header{display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:.55rem}.battle-linked-teams>article>header>svg{color:var(--rt-success,var(--good))}.battle-linked-teams>article>header small,.battle-linked-teams>article>header strong{display:block}.battle-linked-teams>article>header small{color:var(--rt-success,var(--good));font-size:.64rem;font-weight:850;text-transform:uppercase}.battle-linked-teams>article>ul{display:grid;gap:.35rem;list-style:none;margin:.65rem 0 0;padding:0}.battle-linked-teams>article>ul li{display:grid;grid-template-columns:36px minmax(0,1fr);align-items:center;gap:.5rem;min-height:44px;border-top:1px solid var(--rt-rule,var(--rule-soft));padding-top:.35rem}.battle-linked-teams li strong,.battle-linked-teams li small{display:block}.battle-linked-teams li small{color:var(--rt-text-muted,var(--ink-muted));font-size:.65rem}.battle-linked-summary dl{display:grid;margin:0 0 1rem}.battle-linked-summary dl div{display:flex;justify-content:space-between;gap:1rem;padding:.65rem 0;border-bottom:1px solid var(--rt-rule,var(--rule-soft))}.battle-linked-summary dt{color:var(--rt-text-muted,var(--ink-muted));font-size:.7rem;font-weight:850}.battle-linked-summary dd{margin:0;text-align:right}.battle-linked-summary .quiet-action{width:100%;text-decoration:none}.enrolled-list{display:grid;gap:.45rem;list-style:none;padding:0;margin:1rem 0}.enrolled-list li{display:flex;justify-content:space-between;align-items:center;gap:1rem;border:1px solid var(--rt-rule,var(--rule-soft));padding:.55rem .7rem}.enrolled-list strong,.enrolled-list small{display:block}.icon-action{width:44px;padding:0}.start-action{width:100%}.bounded-note{display:flex;justify-content:center;gap:.4rem;color:var(--rt-text-muted,var(--ink-muted))}.accepted-grid{display:grid;gap:.5rem;margin-block:1rem}.accepted-grid article{display:flex;justify-content:space-between;border-bottom:1px solid var(--rt-rule,var(--rule-soft));padding:.55rem}.button-row{display:flex;justify-content:flex-end;gap:.6rem}.participant-performer-choice{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;margin:0 0 1rem;padding:1rem;border:2px solid var(--rt-pending,var(--warn));clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%)}.participant-performer-choice legend{padding-inline:.45rem;color:var(--rt-text-strong,var(--ink-bright));font-size:clamp(1.25rem,2.5vw,1.75rem);font-weight:900}.participant-performer-choice button{position:relative;display:grid;gap:.25rem;min-height:132px;border:2px solid var(--rt-rule,var(--rule-soft));background:var(--rt-bg-canvas,var(--paper-inset));color:var(--rt-text,var(--ink));padding:1rem;text-align:left;cursor:pointer}.participant-performer-choice button.selected{border:3px solid var(--rt-focus,var(--info));padding:calc(1rem - 1px)}.participant-kind{color:var(--rt-text-muted,var(--ink-muted));font-size:.72rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.participant-performer-choice strong{color:var(--rt-text-strong,var(--ink-bright));font-size:1.35rem}.participant-performer-choice small{font-size:.82rem}.participant-performer-choice em{display:flex;align-items:center;gap:.35rem;color:var(--rt-focus,var(--info));font-style:normal;font-weight:900}.participant-choice-empty{display:grid;place-items:center;min-height:12rem;border:1px dashed var(--rt-rule,var(--rule-soft));color:var(--rt-text-muted,var(--ink-muted));text-align:center}.active-performer{color:var(--rt-text-muted,var(--ink-muted))}.move-options,.dice-pools{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem;border:0;padding:0;margin:1rem 0}.move-options legend,.dice-pools legend{grid-column:1/-1;margin-bottom:.5rem;color:var(--rt-text-muted,var(--ink-muted));font-weight:850}.move-options label{position:relative;display:block;min-height:128px;border:1px solid var(--rt-rule,var(--rule-soft));padding:.9rem;cursor:pointer}.move-options label.selected{border:3px solid var(--rt-focus,var(--info));padding:calc(.9rem - 2px)}.move-options label.unavailable{border-style:dashed;color:var(--rt-text-muted,var(--ink-muted))}.move-options input{position:absolute;inline-size:1px;block-size:1px;opacity:0}.move-options strong,.move-options small{display:block}.partner-effect-choice{grid-template-columns:44px minmax(0,1fr);align-items:center;min-height:64px;border:1px solid var(--rt-info,var(--info));background:var(--rt-bg-canvas,var(--paper-inset));padding:.65rem .8rem;cursor:pointer}.partner-effect-choice input{width:24px;min-height:24px;accent-color:var(--rt-focus,var(--info))}.partner-effect-choice strong,.partner-effect-choice small{display:block}.move-options strong{font-size:1.05rem;color:var(--rt-text-strong,var(--ink-bright))}.move-options small{margin-top:.65rem}.move-options small>svg{vertical-align:middle;margin-right:.3rem}.dice-pools{grid-template-columns:repeat(5,minmax(0,1fr))}.pool-control>span{display:block;text-align:center;color:var(--rt-text-strong,var(--ink-bright))}.pool-control small{display:block;color:var(--rt-text-muted,var(--ink-muted));font-size:.65rem}.pool-control>div{display:grid;grid-template-columns:44px 1fr 44px;margin-top:.35rem;border:1px solid var(--rt-rule,var(--rule-soft))}.pool-control button{padding:0;border:0}.pool-control output{display:grid;place-items:center;border-inline:1px solid var(--rt-rule,var(--rule-soft));font:700 1rem var(--font-mono)}.assembled-roll{border:1px solid var(--rt-rule,var(--rule-soft));background:var(--rt-bg-canvas,var(--paper-inset));padding:.9rem;margin-block:1rem}.assembled-roll>strong{color:var(--rt-pending,var(--warn))}.assembled-roll p{display:flex;align-items:center;flex-wrap:wrap;gap:.65rem;margin:.65rem 0;font:650 .95rem var(--font-mono)}.assembled-roll small{color:var(--rt-text-muted,var(--ink-muted))}.submit-appeal{width:100%;min-height:56px;font-size:1.1rem}.reroll-decision{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:.8rem;border:1px solid var(--rt-success,var(--good));background:var(--rt-bg-canvas,var(--paper-inset));padding:1rem}.reroll-decision>svg{color:var(--rt-success,var(--good))}.reroll-decision p,.reroll-decision h3{margin:0}.reroll-decision p{color:var(--rt-success,var(--good));font-size:.7rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.reroll-decision h3{margin:.2rem 0;font:700 1.2rem var(--font-book)}.reroll-decision label,.reroll-decision .button-row{grid-column:2}.intervention-panel,.gm-tools{margin-top:1rem}.intervention-panel summary,.gm-tools>summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:850}.intervention-form{grid-template-columns:repeat(2,minmax(0,1fr));padding-top:1rem}.rotation-performer-choice{display:grid;gap:.65rem}.rotation-performer-choice p{margin-top:0}.rotation-performer-choice .quiet-action{justify-content:flex-start;width:100%}.watch-state{display:grid;place-items:center;text-align:center;min-height:20rem;color:var(--rt-text-muted,var(--ink-muted))}.undeclared-prize{display:grid;gap:.65rem;border:1px solid var(--rt-pending,var(--warn));background:var(--rt-bg-canvas,var(--paper-inset));padding:1rem;margin-block:1rem}.undeclared-prize p{margin:0}.settlement-list{display:grid;gap:.5rem;margin:1rem 0}.settlement-prizes{display:grid;gap:.3rem;margin:0;padding-left:1.2rem}.settlement-list article{display:grid;grid-template-columns:3rem 1fr auto;align-items:center;border:1px solid var(--rt-rule,var(--rule-soft));padding:.7rem}.settlement-list article>b{font:800 1.4rem var(--font-mono)}.settlement-list small{display:block}.settlement-list em{color:var(--rt-pending,var(--warn));font-style:normal;font-weight:850}.completion-panel{display:flex;align-items:center;gap:1rem;color:var(--rt-success,var(--good))}.completion-panel h2{margin:0}.score-table{max-width:100%;overflow-x:auto;font-size:.8rem}.score-head,.score-row{display:grid;grid-template-columns:minmax(8rem,1.7fr) repeat(4,minmax(3rem,.6fr));align-items:center;border-bottom:1px solid var(--rt-rule,var(--rule-soft))}.score-head{color:var(--rt-text-muted,var(--ink-muted));font-size:.68rem;font-weight:900}.score-head span,.score-row>span,.score-row>strong{padding:.6rem .35rem;text-align:center}.score-head span:first-child,.score-row>span:first-child{text-align:left}.score-row small{display:block;color:var(--rt-text-muted,var(--ink-muted));font-size:.65rem}.score-row>strong{font:800 1rem var(--font-mono)}.score-voltage{display:grid;gap:.1rem}.score-voltage small{font-family:var(--font-mono)}.result-row{border:1px solid var(--rt-success,var(--good));margin-top:.55rem}.result-row summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:.6rem;min-height:64px;padding:.6rem;cursor:pointer;color:var(--rt-success,var(--good))}.result-row summary strong,.result-row summary small{display:block;color:var(--rt-text-strong,var(--ink-bright))}.result-row summary small{color:var(--rt-text-muted,var(--ink-muted))}.result-row summary em{font-style:normal;font-size:.75rem}.result-row>div{border-top:1px solid var(--rt-rule,var(--rule-soft));padding:.7rem}.dice-results{display:flex;flex-wrap:wrap;gap:.35rem}.dice-results b{display:grid;place-items:center;width:2rem;height:2rem;border:1px solid var(--rt-rule,var(--rule-soft));font-family:var(--font-mono)}.result-row ul{padding-left:1.2rem}.gm-tools form{grid-template-columns:1fr;padding-top:1rem}.gm-tools hr{border:0;border-top:1px solid var(--rt-rule,var(--rule-soft));margin:1rem 0}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible,[data-contest-primary]:focus-visible,.score-table:focus-visible,.move-options label:focus-within{outline:3px solid var(--rt-focus,#59d8ff);outline-offset:3px}button:disabled,fieldset:disabled{opacity:.55;cursor:not-allowed}
@media(max-width:1050px){.cockpit-grid{grid-template-columns:1fr}.secondary-column{grid-template-columns:1fr 1fr}.gm-tools{grid-column:1/-1}}
@media(max-width:760px){.score-head,.score-row{min-width:22rem}.participant-performer-choice{grid-template-columns:1fr}.contest-header{grid-template-columns:1fr auto}.contest-heading{grid-column:1/-1;grid-row:2;text-align:left}.header-meta{justify-content:flex-start}.enrollment-form,.intro-form{grid-template-columns:1fr}.intro-form>p{grid-column:auto}.battle-team-grid,.battle-intro-team-grid{grid-template-columns:1fr}.battle-encounter-handoff--ready dl,.battle-linked-facts{grid-template-columns:1fr}.battle-encounter-handoff--ready dl div,.battle-linked-facts div{border-right:0;border-bottom:1px solid var(--rt-rule,var(--rule-soft))}.battle-encounter-handoff--ready dl div:last-child,.battle-linked-facts div:last-child{border-bottom:0}.battle-linked-pools>header{align-items:flex-start;flex-direction:column}.battle-linked-summary dl div{align-items:flex-start;flex-direction:column}.battle-linked-summary dd{text-align:left}.battle-intro-progress{grid-template-columns:repeat(2,minmax(0,1fr))}.battle-intro-progress>*:nth-child(2){border-right:0}.battle-intro-progress>*:nth-child(-n+2){border-bottom:1px solid var(--rt-rule,var(--rule-soft))}.battle-setup-progress>div{align-items:flex-start;flex-direction:column;gap:.25rem}.battle-setup-progress dl{grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem}.battle-setup-progress dl div:nth-child(2){border-right:0}.move-options{grid-template-columns:1fr}.dice-pools{grid-template-columns:repeat(2,1fr)}.secondary-column{grid-template-columns:1fr}.gm-tools{grid-column:auto}.score-head,.score-row{grid-template-columns:minmax(7rem,1.6fr) repeat(4,minmax(2.7rem,.5fr))}.score-head span,.score-row>span,.score-row>strong{padding:.5rem .15rem}}
@media(max-width:480px){.method-policy{grid-template-columns:1fr}.battle-linked-heading{grid-template-columns:1fr}.battle-linked-heading>svg{width:38px;height:38px}.battle-linked-pools .battle-pool-strip{font-size:.72rem}.battle-intro-progress{grid-template-columns:1fr}.battle-intro-progress>*{border-right:0;border-bottom:1px solid var(--rt-rule,var(--rule-soft))}.battle-intro-progress>*:last-child{border-bottom:0}.participant-performer-choice{padding:.7rem}.stage-line{grid-template-columns:1fr}.performer-card{min-width:0}.performer-card dl{grid-template-columns:repeat(2,minmax(0,1fr))}.performer-card dl div{min-width:0}.dice-pools{grid-template-columns:1fr}.intervention-form{grid-template-columns:1fr}.assembled-roll p{align-items:flex-start;flex-direction:column}.accepted-grid article{align-items:flex-start;flex-direction:column}.result-row summary em{display:none}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
</style>
