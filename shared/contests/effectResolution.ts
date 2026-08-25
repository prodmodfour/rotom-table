import { contestCatalog } from '#shared/contests/catalog'
import type { ContestEffectId } from '#shared/contests/ids'

export interface ContestEffectConsequenceV1 {
  readonly contestantId: string
  readonly performerId: string | null
  readonly appealDelta: number
  readonly fumbleDelta: number
  readonly voltageDelta: number
  readonly reason: string
}

export interface ContestEffectVoltageTargetV1 {
  readonly contestantId: string
  readonly performerId: string | null
  readonly voltage: number
}

export interface ContestEffectFumbleTargetV1 {
  readonly contestantId: string
  readonly protected: boolean
}

export const cappedContestVoltage = (value: number): number => Math.max(
  0,
  Math.min(contestCatalog.performance.voltage.maximum, Math.floor(value)),
)

/** One canonical Appeal-result scorer shared by ordinary and Battle Contests. */
export const scoreContestAppealResults = (
  results: readonly number[],
  effectId: ContestEffectId,
  centerOfAttention: boolean,
  fixedPerDie = false,
): { appeal: number, fumble: number } => {
  if (fixedPerDie) return { appeal: results.length, fumble: 0 }
  if (effectId === 'safe-option') return { appeal: results.filter(value => value === 6).length, fumble: 0 }
  if (effectId === 'sabotage') return { appeal: 0, fumble: 0 }
  if (effectId === 'tease') return {
    appeal: results.filter(value => value >= 5).length,
    fumble: centerOfAttention ? results.filter(value => value === 1).length : 0,
  }
  const table = centerOfAttention
    ? contestCatalog.performance.centerScoring
    : contestCatalog.performance.normalScoring
  let appeal = 0
  let fumble = 0
  for (const value of results) {
    appeal += table[String(value)]?.appeal ?? 0
    fumble += table[String(value)]?.fumble ?? 0
  }
  if (effectId === 'desperation') {
    appeal += results.filter(value => value === 6).length
    fumble += results.filter(value => value === 1).length
  }
  return { appeal, fumble }
}

const appendConsequence = (
  rows: ContestEffectConsequenceV1[],
  input: ContestEffectConsequenceV1,
): void => {
  const existing = rows.find(row => row.contestantId === input.contestantId
    && row.performerId === input.performerId
    && row.reason === input.reason)
  if (existing) {
    const mutable = existing as {
      appealDelta: number
      fumbleDelta: number
      voltageDelta: number
    }
    mutable.appealDelta += input.appealDelta
    mutable.fumbleDelta += input.fumbleDelta
    mutable.voltageDelta += input.voltageDelta
    return
  }
  rows.push({ ...input })
}

export interface ResolveContestEffectConsequencesInputV1 {
  readonly effectId: ContestEffectId
  readonly results: readonly number[]
  readonly actor: ContestEffectVoltageTargetV1
  /** Optional paired recipient for Trainer Participant Attention Grabber. */
  readonly attentionRecipient?: ContestEffectVoltageTargetV1 | null
  readonly adjacentVoltageTargets: readonly ContestEffectVoltageTargetV1[]
  readonly adjacentFumbleTargets: readonly ContestEffectFumbleTargetV1[]
  readonly repeatedMove: boolean
  readonly matchingType: boolean
}

export interface ResolvedContestEffectConsequencesV1 {
  readonly actorVoltage: number
  readonly attentionRecipientVoltage: number | null
  readonly consequences: readonly ContestEffectConsequenceV1[]
}

/**
 * Resolve the canonical Contest Effect handler against explicit target scopes.
 * The caller owns how stage positions or Battle placements produce those
 * scopes; this function owns effect arithmetic and canonical reasons.
 */
export const resolveContestEffectConsequences = (
  input: ResolveContestEffectConsequencesInputV1,
): ResolvedContestEffectConsequencesV1 => {
  let actorVoltage = cappedContestVoltage(input.actor.voltage)
  let attentionRecipientVoltage = input.attentionRecipient
    ? cappedContestVoltage(input.attentionRecipient.voltage)
    : null
  const adjacentVoltages = new Map(input.adjacentVoltageTargets.map(target => [
    `${target.contestantId}:${target.performerId ?? 'shared'}`,
    cappedContestVoltage(target.voltage),
  ]))
  const consequences: ContestEffectConsequenceV1[] = []
  const voltageChange = (
    target: ContestEffectVoltageTargetV1,
    previous: number,
    delta: number,
    reason: string,
  ): number => {
    const next = cappedContestVoltage(previous + delta)
    const actual = next - previous
    if (actual !== 0) appendConsequence(consequences, {
      contestantId: target.contestantId,
      performerId: target.performerId,
      appealDelta: 0,
      fumbleDelta: 0,
      voltageDelta: actual,
      reason,
    })
    return next
  }
  const changeActor = (delta: number, reason: string): void => {
    actorVoltage = voltageChange(input.actor, actorVoltage, delta, reason)
  }
  const changeAdjacent = (delta: number, reason: string): void => {
    for (const target of input.adjacentVoltageTargets) {
      const key = `${target.contestantId}:${target.performerId ?? 'shared'}`
      adjacentVoltages.set(key, voltageChange(
        target,
        adjacentVoltages.get(key) ?? cappedContestVoltage(target.voltage),
        delta,
        reason,
      ))
    }
  }
  const changeAttentionRecipient = (delta: number): void => {
    if (!input.attentionRecipient || attentionRecipientVoltage === null) {
      changeActor(delta, 'Attention Grabber')
      return
    }
    attentionRecipientVoltage = voltageChange(
      input.attentionRecipient,
      attentionRecipientVoltage,
      delta,
      'Attention Grabber',
    )
  }

  if (input.effectId === 'big-show') changeActor(3, 'Big Show')
  if (input.effectId === 'excitement') changeActor(2, 'Excitement')
  if (input.effectId === 'steady-performance') changeActor(1, 'Steady Performance')
  if (input.effectId === 'special-attention') changeAdjacent(1, 'Special Attention')
  if (input.effectId === 'unsettling') {
    changeActor(-2, 'Unsettling')
    changeAdjacent(-1, 'Unsettling')
  }
  if (input.effectId === 'incentives' && input.matchingType) {
    changeActor(1, 'Incentives')
    changeAdjacent(-1, 'Incentives')
  }
  if (input.effectId === 'gamble') changeActor(input.results.filter(value => value === 6).length, 'Gamble')
  if (input.effectId === 'reliable' && input.repeatedMove) changeActor(1, 'Reliable repeat')
  if (input.effectId === 'catching-up') changeActor(1, 'Catching Up')
  if (input.effectId === 'good-show') changeActor(1, 'Good Show')
  if (input.effectId === 'exhausting-act') changeActor(-2, 'Exhausting Act')
  if (input.effectId === 'attention-grabber') {
    for (const target of input.adjacentVoltageTargets) {
      const key = `${target.contestantId}:${target.performerId ?? 'shared'}`
      const previous = adjacentVoltages.get(key) ?? cappedContestVoltage(target.voltage)
      const loss = Math.min(2, previous)
      if (loss === 0) continue
      adjacentVoltages.set(key, voltageChange(target, previous, -loss, 'Attention Grabber'))
      changeAttentionRecipient(loss)
    }
  }
  if (input.effectId === 'sabotage') {
    for (const target of input.adjacentFumbleTargets) appendConsequence(consequences, {
      contestantId: target.contestantId,
      performerId: null,
      appealDelta: 0,
      fumbleDelta: target.protected ? 0 : input.results.length,
      voltageDelta: 0,
      reason: 'Sabotage',
    })
  }
  if (input.effectId === 'tease') {
    const sixes = input.results.filter(value => value === 6).length
    for (const target of input.adjacentFumbleTargets) appendConsequence(consequences, {
      contestantId: target.contestantId,
      performerId: null,
      appealDelta: 0,
      fumbleDelta: target.protected ? 0 : sixes,
      voltageDelta: 0,
      reason: 'Tease',
    })
  }

  return Object.freeze({
    actorVoltage,
    attentionRecipientVoltage,
    consequences: Object.freeze(consequences.map(row => Object.freeze({ ...row }))),
  })
}

/** Canonical post-handler Voltage transitions shared by every Contest mode. */
export const terminalContestEffectVoltage = (
  effectId: ContestEffectId,
  voltage: number,
): number => {
  if (effectId === 'seen-nothing-yet') return 0
  if (effectId === 'get-ready' || effectId === 'double-time') return cappedContestVoltage(voltage - 2)
  return cappedContestVoltage(voltage)
}
