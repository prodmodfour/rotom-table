export const LOCAL_ASSISTED_FOLLOW_UP_NAMES = [
  'Spite',
  'Cute Charm',
  'Poison Point',
  'Moxie',
  'Celebrate',
  'Attack of Opportunity',
] as const

export type LocalAssistedFollowUpName = typeof LOCAL_ASSISTED_FOLLOW_UP_NAMES[number]

export const LOCAL_MOVE_REACTION_ASSISTANCE_NOTICE =
  'Local-only after the accepted move. This assisted follow-up cannot interrupt that move and is not restored after refresh or reconnect.'

export const ATTACK_OF_OPPORTUNITY_ASSISTANCE_NOTICE =
  'This assisted follow-up appears after the provoking action. It is not a durable interrupt; resolve it now and do not rely on reconnect recovery.'

export const localAssistedFollowUpLabel = (name: LocalAssistedFollowUpName): string =>
  `Assisted follow-up · ${name}`

export const attackOfOpportunityAssistedFollowUpTitle = (input: {
  attackerName: string
  provokerName: string
}): string =>
  `${input.attackerName} has an assisted Attack of Opportunity follow-up against ${input.provokerName}. ${ATTACK_OF_OPPORTUNITY_ASSISTANCE_NOTICE} Right-click to clear this indicator.`
