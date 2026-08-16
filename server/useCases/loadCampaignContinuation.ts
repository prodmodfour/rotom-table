import { createHash } from 'node:crypto'
import type { AuthRole } from '../../shared/auth'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { POKEMON_EGG_ACTIVE_STATUSES, type PokemonEggDocumentV1 } from '../../shared/breeding/egg'
import { BREEDING_WORKSHOP_PATH } from '../../shared/breeding/workshop'
import {
  parseCampaignContinuationProjection,
  type CampaignContinuationProjectionV1,
} from '../../shared/campaignContinuation'
import type { EncounterSettlementDocument } from '../../shared/encounterSettlement/document'
import type { EncounterWorkspaceSummary } from '../../shared/encounterWorkspace/library'
import { encounterWorkspacePath } from '../../shared/encounterWorkspace/routes'
import type { PlayerProfile } from '../../shared/playerProfiles'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteEncounterSettlementRepository } from '../storage/encounterSettlementRepository'
import {
  loadCampaignAttentionUseCase,
  readCampaignAttentionAuthority,
  type CampaignAttentionAuthoritySnapshot,
} from './loadCampaignAttention'
import { listEncounterWorkspacesUseCase } from './listEncounterWorkspaces'

export const CAMPAIGN_CONTINUATION_LIMIT = 10_000

export interface LoadCampaignContinuationInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
}

export interface LoadCampaignContinuationDependencies {
  readonly database?: RotomDatabase
  readonly loadAuthority?: () => CampaignAttentionAuthoritySnapshot
  readonly listWorkspaces?: (role: AuthRole) => readonly EncounterWorkspaceSummary[]
  readonly listSettlements?: () => readonly EncounterSettlementDocument[]
}

const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')

const defaultSettlements = (database: RotomDatabase): readonly EncounterSettlementDocument[] => {
  const countRow = database.connection.prepare(
    'SELECT COUNT(*) AS count FROM encounter_settlements',
  ).get() as { readonly count?: unknown } | undefined
  if (!Number.isSafeInteger(countRow?.count) || Number(countRow!.count) < 0
    || Number(countRow!.count) > CAMPAIGN_CONTINUATION_LIMIT) {
    throw new Error(`Campaign continuation settlements must be complete and bounded to ${CAMPAIGN_CONTINUATION_LIMIT} records.`)
  }
  const rows = database.connection.prepare(
    'SELECT settlement_id AS id FROM encounter_settlements ORDER BY settlement_id ASC LIMIT ?',
  ).all(CAMPAIGN_CONTINUATION_LIMIT + 1) as unknown as { readonly id?: unknown }[]
  if (rows.length !== Number(countRow!.count) || rows.some(row => typeof row.id !== 'string')) {
    throw new Error('Campaign continuation lost its complete settlement identity read.')
  }
  const repository = createSqliteEncounterSettlementRepository(database)
  return Object.freeze(rows.map((row) => {
    const settlement = repository.get(row.id as string)
    if (!settlement) throw new Error('Campaign continuation settlement disappeared during its complete read.')
    return settlement
  }))
}

const activeEncounterRows = (
  summaries: readonly EncounterWorkspaceSummary[],
): readonly EncounterWorkspaceSummary[] => summaries.filter(summary => (
  summary.lifecycle === 'active' || summary.lifecycle === 'paused'
  || (summary.lifecycle === null && summary.state === 'live')
)).sort((left, right) => (
  Number(right.lifecycle === 'active' || (right.lifecycle === null && right.state === 'live'))
  - Number(left.lifecycle === 'active' || (left.lifecycle === null && left.state === 'live'))
  || (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
  || left.encounterId.localeCompare(right.encounterId)
))

const settlementState = (
  status: EncounterSettlementDocument['status'],
): 'needs-review' | 'ready-to-finish' | 'finishing' => {
  if (status === 'ready') return 'ready-to-finish'
  if (status === 'committing') return 'finishing'
  return 'needs-review'
}

export const projectCampaignContinuation = (input: {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly attention: ReturnType<typeof loadCampaignAttentionUseCase>
  readonly workspaces: readonly EncounterWorkspaceSummary[]
  readonly settlements: readonly EncounterSettlementDocument[]
  readonly eggs: readonly PokemonEggDocumentV1[]
}): CampaignContinuationProjectionV1 => {
  if ((input.role === 'gm' && input.attention.scope !== 'gm')
    || (input.role === 'player' && input.attention.scope !== 'owner')) {
    throw new Error('Campaign continuation attention scope does not match its authenticated role.')
  }
  if (input.workspaces.length > CAMPAIGN_CONTINUATION_LIMIT
    || input.settlements.length > CAMPAIGN_CONTINUATION_LIMIT
    || input.eggs.length > CAMPAIGN_CONTINUATION_LIMIT) {
    throw new Error(`Campaign continuation inputs are bounded to ${CAMPAIGN_CONTINUATION_LIMIT} records.`)
  }
  const workspaceIds = input.workspaces.map(row => row.encounterId)
  const settlementIds = input.settlements.map(row => row.settlementId)
  const eggIds = input.eggs.map(row => row.eggId)
  if (new Set(workspaceIds).size !== workspaceIds.length
    || new Set(settlementIds).size !== settlementIds.length
    || new Set(eggIds).size !== eggIds.length) {
    throw new Error('Campaign continuation requires unique current authority identities.')
  }

  const active = activeEncounterRows(input.workspaces)
  const primaryEncounter = active[0] ?? null
  const activeEncounter = primaryEncounter ? Object.freeze({
    label: primaryEncounter.name,
    state: primaryEncounter.lifecycle === 'paused' ? 'paused' as const : 'active' as const,
    round: primaryEncounter.round,
    participantCount: primaryEncounter.participantCount,
    href: encounterWorkspacePath(primaryEncounter.encounterId),
  }) : null

  const workspaceByEncounter = new Map(input.workspaces.map(row => [row.encounterId, row]))
  const unfinished = input.settlements
    .filter(row => row.status !== 'completed' && row.status !== 'cancelled')
    .flatMap((row) => {
      const workspace = workspaceByEncounter.get(row.encounter.encounterId)
      return workspace ? [{ row, workspace }] : []
    })
    .sort((left, right) => (
      right.row.updatedAtCampaignMinute - left.row.updatedAtCampaignMinute
      || left.row.settlementId.localeCompare(right.row.settlementId)
    ))
  const primarySettlement = unfinished[0] ?? null
  const unfinishedSettlement = primarySettlement ? Object.freeze({
    label: primarySettlement.workspace.name,
    state: settlementState(primarySettlement.row.status),
    openWorkCount: input.role === 'gm' ? primarySettlement.row.unresolvedGates.length : null,
    href: encounterWorkspacePath(primarySettlement.workspace.encounterId),
  }) : null

  const ownedTrainerSlugs = new Set((input.role === 'player'
    ? input.playerProfile?.linkedCharacters ?? []
    : []).filter(link => link.sheetKind === 'trainer').map(link => link.sheetSlug))
  const activeEggStatuses = new Set<string>(POKEMON_EGG_ACTIVE_STATUSES)
  const visibleEggs = input.eggs.filter(egg => (
    activeEggStatuses.has(egg.status)
    && (input.role === 'gm' || ownedTrainerSlugs.has(egg.ownerTrainerSlug))
  ))
  const eggs = Object.freeze({
    active: visibleEggs.length,
    incubating: visibleEggs.filter(egg => egg.status === 'incubating').length,
    ready: visibleEggs.filter(egg => egg.status === 'ready').length,
    needsAdjudication: visibleEggs.filter(egg => egg.status === 'awaiting-special-adjudication').length,
    hatching: visibleEggs.filter(egg => egg.status === 'hatching').length,
    href: BREEDING_WORKSHOP_PATH,
  })

  const payload = {
    schemaVersion: 1 as const,
    attention: input.attention,
    activeEncounter,
    additionalActiveEncounters: Math.max(0, active.length - 1),
    unfinishedSettlement,
    additionalUnfinishedSettlements: Math.max(0, unfinished.length - 1),
    eggs,
  }
  return parseCampaignContinuationProjection({
    ...payload,
    snapshotId: `campaign-continuation-snapshot:v1:${hash(payload)}`,
  })
}

export const loadCampaignContinuationUseCase = (
  input: LoadCampaignContinuationInput,
  dependencies: LoadCampaignContinuationDependencies = {},
): CampaignContinuationProjectionV1 => {
  const database = dependencies.database ?? getRotomDatabase()
  return database.withTransaction(() => {
    const authority = dependencies.loadAuthority?.()
      ?? readCampaignAttentionAuthority({ database })
    const attention = loadCampaignAttentionUseCase(input, { loadAuthority: () => authority })
    const workspaces = dependencies.listWorkspaces?.(input.role)
      ?? listEncounterWorkspacesUseCase({ role: input.role }).summaries
    const settlements = dependencies.listSettlements?.() ?? defaultSettlements(database)
    return projectCampaignContinuation({
      ...input,
      attention,
      workspaces,
      settlements,
      eggs: authority.eggs,
    })
  })
}
