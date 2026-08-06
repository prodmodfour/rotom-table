import type { TrainerSheet } from '~/types/trainerSheet'
import type { EffectiveEdgeSet } from '#shared/edgeAutomation/effective'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { resolveEffectiveEdges } from './effectiveEdges'

export type EdgeCampaignActionId =
  | 'craft-basic-ball'
  | 'craft-repel'
  | 'cook-basic-food'
  | 'craft-apricorn-ball'
  | 'craft-gem'
  | 'transmute-evolution-stone'
  | 'scribe-cleanse-tag'
  | 'plant-apricorn-or-tier-1-berry'
  | 'groom-team'
  | 'identify-fossil'
  | 'reanimate-fossil'
  | 'repair-broken-ball'
  | 'begin-breeding'

export interface EdgeCampaignResourceSnapshot {
  readonly money: number
  readonly items: Readonly<Record<string, number>>
  readonly tools: ReadonlySet<'pokeball-toolbox' | 'chemistry-set' | 'portable-grower' | 'fertilized-soil' | 'groomers-kit' | 'reanimation-machine'>
  readonly dailyUses: Readonly<Record<string, number>>
  /** Server-recorded d20/check total where an action requires a check. */
  readonly checkTotal?: number | null
}

export interface EdgeCampaignOperationRequest {
  readonly actionId: EdgeCampaignActionId
  readonly outputId?: string | null
  readonly inputId?: string | null
  readonly targetIds?: readonly string[]
}

export interface EdgeCampaignOperationPlan {
  readonly ok: boolean
  readonly sourceEdge: string
  readonly actionId: EdgeCampaignActionId
  readonly moneyDelta: number
  readonly itemDeltas: Readonly<Record<string, number>>
  readonly dailyUseDeltas: Readonly<Record<string, number>>
  readonly permissionFacts: readonly string[]
  readonly reasonCode: string | null
  readonly message: string
  readonly delegatedRequest: {
    readonly capabilityId: 'breeding.v1'
    readonly contractId: 'edge.breeder.request.v1'
  } | null
}

const ACTION_EDGE: Readonly<Record<EdgeCampaignActionId, string>> = Object.freeze({
  'craft-basic-ball': 'Basic Balls',
  'craft-repel': 'Repel Crafter',
  'cook-basic-food': 'Basic Cooking',
  'craft-apricorn-ball': 'Apricorn Balls',
  'craft-gem': 'Gem Lore',
  'transmute-evolution-stone': 'Gem Lore',
  'scribe-cleanse-tag': 'Tag Scribe',
  'plant-apricorn-or-tier-1-berry': 'Green Thumb',
  'groom-team': 'Groomer',
  'identify-fossil': 'Paleontologist',
  'reanimate-fossil': 'Paleontologist',
  'repair-broken-ball': 'Poké Ball Repair',
  'begin-breeding': 'Breeder',
})

const normalized = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
const quantity = (resources: EdgeCampaignResourceSnapshot, item: string): number => Object.entries(resources.items)
  .find(([name]) => normalized(name) === normalized(item))?.[1] ?? 0

const rejected = (actionId: EdgeCampaignActionId, edge: string, reasonCode: string, message: string): EdgeCampaignOperationPlan => Object.freeze({
  ok: false,
  sourceEdge: edge,
  actionId,
  moneyDelta: 0,
  itemDeltas: Object.freeze({}),
  dailyUseDeltas: Object.freeze({}),
  permissionFacts: Object.freeze([]),
  reasonCode,
  message,
  delegatedRequest: null,
})

const accepted = (input: {
  actionId: EdgeCampaignActionId
  edge: string
  moneyDelta?: number
  itemDeltas?: Readonly<Record<string, number>>
  dailyUseDeltas?: Readonly<Record<string, number>>
  facts?: readonly string[]
  message: string
}): EdgeCampaignOperationPlan => Object.freeze({
  ok: true,
  sourceEdge: input.edge,
  actionId: input.actionId,
  moneyDelta: input.moneyDelta ?? 0,
  itemDeltas: Object.freeze({ ...(input.itemDeltas ?? {}) }),
  dailyUseDeltas: Object.freeze({ ...(input.dailyUseDeltas ?? {}) }),
  permissionFacts: Object.freeze([...(input.facts ?? [])]),
  reasonCode: null,
  message: input.message,
  delegatedRequest: null,
})

const requireTool = (
  resources: EdgeCampaignResourceSnapshot,
  tool: EdgeCampaignResourceSnapshot['tools'] extends ReadonlySet<infer Tool> ? Tool : never,
  actionId: EdgeCampaignActionId,
  edge: string,
): EdgeCampaignOperationPlan | null => resources.tools.has(tool)
  ? null : rejected(actionId, edge, 'edge.campaign.tool-missing', `This operation requires ${tool}.`)

/**
 * Pure Edge-owned campaign planner. A use case supplies a server snapshot and
 * atomically applies the returned deltas; no browser-authored inventory result
 * is accepted.
 */
export const planTrainerEdgeCampaignOperation = (
  sheet: TrainerSheet,
  request: EdgeCampaignOperationRequest,
  resources: EdgeCampaignResourceSnapshot,
  options: {
    readonly breedingCapabilityAvailable?: boolean
    /** Server-resolved projection; callers must never forward a client-authored set. */
    readonly effectiveEdgeSet?: EffectiveEdgeSet
  } = {},
): EdgeCampaignOperationPlan => {
  const edge = ACTION_EDGE[request.actionId]
  const effectiveEdgeSet = options.effectiveEdgeSet
    ?? resolveEffectiveEdges({ ownerId: sheet.slug, family: 'trainer', sheet })
  if (effectiveEdgeSet.ownerId !== sheet.slug || effectiveEdgeSet.family !== 'trainer') {
    return rejected(request.actionId, edge, 'edge.campaign.effective-projection-invalid', 'The effective Trainer Edge projection does not match this Trainer.')
  }
  if (!effectiveEdgeSet.instances.some(instance => instance.effective && instance.canonicalId === edge)) {
    return rejected(request.actionId, edge, 'edge.campaign.permission-missing', `${edge} is not effective.`)
  }
  const output = request.outputId?.trim() ?? ''
  const input = request.inputId?.trim() ?? ''

  if (request.actionId === 'begin-breeding') {
    if (!options.breedingCapabilityAvailable) {
      return rejected(request.actionId, edge, 'downstream-capability-unavailable', 'The authoritative breeding.v1 subsystem is unavailable.')
    }
    return Object.freeze({
      ...accepted({ actionId: request.actionId, edge, message: 'Breeding request is ready for the downstream authority.' }),
      delegatedRequest: Object.freeze({ capabilityId: 'breeding.v1', contractId: 'edge.breeder.request.v1' }),
    })
  }
  if (request.actionId === 'craft-basic-ball') {
    const missing = requireTool(resources, 'pokeball-toolbox', request.actionId, edge)
    if (missing) return missing
    const costs: Readonly<Record<string, number>> = { 'Basic Ball': 100, 'Great Ball': 175 }
    const canonicalOutput = Object.keys(costs).find(name => normalized(name) === normalized(output))
    const cost = canonicalOutput ? costs[canonicalOutput] : undefined
    if (!canonicalOutput || cost === undefined) return rejected(request.actionId, edge, 'edge.campaign.output-invalid', 'Choose Basic Ball or Great Ball.')
    if (resources.money < cost) return rejected(request.actionId, edge, 'edge.campaign.money-insufficient', `Crafting ${canonicalOutput} costs $${cost}.`)
    return accepted({ actionId: request.actionId, edge, moneyDelta: -cost, itemDeltas: { [canonicalOutput]: 1 }, message: `${canonicalOutput} crafted.` })
  }
  if (request.actionId === 'craft-repel') {
    const missing = requireTool(resources, 'chemistry-set', request.actionId, edge)
    if (missing) return missing
    const costs: Readonly<Record<string, number>> = { Repel: 100, 'Super Repel': 150 }
    const canonicalOutput = Object.keys(costs).find(name => normalized(name) === normalized(output))
    const cost = canonicalOutput ? costs[canonicalOutput] : undefined
    if (!canonicalOutput || cost === undefined) return rejected(request.actionId, edge, 'edge.campaign.output-invalid', 'Choose Repel or Super Repel.')
    if (resources.money < cost) return rejected(request.actionId, edge, 'edge.campaign.money-insufficient', `Crafting ${canonicalOutput} costs $${cost}.`)
    return accepted({ actionId: request.actionId, edge, moneyDelta: -cost, itemDeltas: { [canonicalOutput]: 1 }, message: `${canonicalOutput} crafted.` })
  }
  if (request.actionId === 'cook-basic-food') {
    if (!['candy bar', 'baby food'].includes(normalized(output))) return rejected(request.actionId, edge, 'edge.campaign.output-invalid', 'Choose Candy Bar or Baby Food.')
    if (resources.money < 50) return rejected(request.actionId, edge, 'edge.campaign.ingredients-insufficient', 'Cooking ingredients costing $50 are required.')
    const canonicalOutput = normalized(output) === 'candy bar' ? 'Candy Bar' : 'Baby Food'
    return accepted({ actionId: request.actionId, edge, moneyDelta: -50, itemDeltas: { [canonicalOutput]: 1 }, message: `${canonicalOutput} cooked.` })
  }
  if (request.actionId === 'craft-apricorn-ball') {
    const missing = requireTool(resources, 'pokeball-toolbox', request.actionId, edge)
    if (missing) return missing
    if (!input || !output || quantity(resources, input) < 1) return rejected(request.actionId, edge, 'edge.campaign.input-missing', 'A server-authorized Apricorn and corresponding Ball output are required.')
    return accepted({ actionId: request.actionId, edge, itemDeltas: { [input]: -1, [output]: 1 }, message: `${output} crafted from ${input}.` })
  }
  if (request.actionId === 'craft-gem') {
    if (!/shard/i.test(input) || quantity(resources, input) < 1 || !/gem/i.test(output)) return rejected(request.actionId, edge, 'edge.campaign.input-missing', 'A typed Shard and associated Gem are required.')
    return accepted({ actionId: request.actionId, edge, itemDeltas: { [input]: -1, [output]: 1 }, message: `${output} crafted.` })
  }
  if (request.actionId === 'transmute-evolution-stone') {
    if (!input || !output) return rejected(request.actionId, edge, 'edge.campaign.input-missing', 'A matching Shard or Stone conversion is required.')
    const stoneToShards = /stone/i.test(input) && /shard/i.test(output)
    const required = stoneToShards ? 1 : 4
    const produced = stoneToShards ? 4 : 1
    if (quantity(resources, input) < required) return rejected(request.actionId, edge, 'edge.campaign.input-missing', `This conversion requires ${required} ${input}.`)
    return accepted({ actionId: request.actionId, edge, itemDeltas: { [input]: -required, [output]: produced }, message: `${input} converted to ${output}.` })
  }
  if (request.actionId === 'scribe-cleanse-tag') {
    const occultRank = resolveTrainerSkills(sheet).find(skill => skill.key === 'occultEd')?.rankValue ?? 0
    const maximum = Math.floor(occultRank / 2)
    const used = resources.dailyUses['edge.tag-scribe'] ?? 0
    if (used >= maximum) return rejected(request.actionId, edge, 'edge.campaign.daily-uses-exhausted', 'Tag Scribe has no uses remaining today.')
    return accepted({ actionId: request.actionId, edge, itemDeltas: { 'Cleanse Tags': 1 }, dailyUseDeltas: { 'edge.tag-scribe': 1 }, message: 'Cleanse Tag scribed.' })
  }
  if (request.actionId === 'plant-apricorn-or-tier-1-berry') {
    if (!resources.tools.has('portable-grower') && !resources.tools.has('fertilized-soil')) return rejected(request.actionId, edge, 'edge.campaign.environment-missing', 'A Portable Grower or Fertilized Soil is required.')
    if (!input || quantity(resources, input) < 1) return rejected(request.actionId, edge, 'edge.campaign.input-missing', 'An Apricorn or Tier 1 Berry is required.')
    return accepted({ actionId: request.actionId, edge, itemDeltas: { [input]: -1 }, facts: [`crop:${input}`], message: `${input} planted; the campaign growth system owns its lifecycle.` })
  }
  if (request.actionId === 'groom-team') {
    const missing = requireTool(resources, 'groomers-kit', request.actionId, edge)
    if (missing) return missing
    const targets = [...new Set(request.targetIds ?? [])]
    if (targets.length < 1 || targets.length > 6) return rejected(request.actionId, edge, 'edge.campaign.targets-invalid', 'Groomer requires 1–6 controlled Pokémon.')
    return accepted({ actionId: request.actionId, edge, facts: targets.map(id => `groomed-today:${id}`), message: `${targets.length} Pokémon groomed for one hour.` })
  }
  if (request.actionId === 'identify-fossil') {
    if (!input || quantity(resources, input) < 1) return rejected(request.actionId, edge, 'edge.campaign.input-missing', 'A Fossil is required.')
    const success = (resources.checkTotal ?? -Infinity) >= 10
    return success
      ? accepted({ actionId: request.actionId, edge, facts: [`identified-fossil:${input}`], message: `${input} identified.` })
      : rejected(request.actionId, edge, 'edge.campaign.check-failed', 'The Pokémon Education or Survival Check did not meet DC 10.')
  }
  if (request.actionId === 'reanimate-fossil') {
    const missing = requireTool(resources, 'reanimation-machine', request.actionId, edge)
    if (missing) return missing
    return accepted({ actionId: request.actionId, edge, facts: ['fossil-reanimation-permitted'], message: 'Reanimation permission confirmed; the campaign creature-creation authority owns the result.' })
  }
  const missing = requireTool(resources, 'pokeball-toolbox', request.actionId, edge)
  if (missing) return missing
  if (!input || quantity(resources, input) < 1) return rejected(request.actionId, edge, 'edge.campaign.input-missing', 'A broken Poké Ball is required.')
  if ((resources.checkTotal ?? -Infinity) < 15) {
    return accepted({ actionId: request.actionId, edge, itemDeltas: { [input]: -1 }, facts: [`permanently-broken:${input}`], message: 'Repair failed; the ball is permanently broken.' })
  }
  return accepted({ actionId: request.actionId, edge, facts: [`repaired:${input}`], message: `${input} repaired.` })
}
