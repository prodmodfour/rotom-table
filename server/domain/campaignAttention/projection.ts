import { createHash } from 'node:crypto'
import { stableJsonStringify } from '../../../shared/automation/stableJson'
import { normalizePlayerProfile, type PlayerProfile } from '../../../shared/playerProfiles'
import {
  CAMPAIGN_ATTENTION_PROJECTION_LIMIT,
  campaignAttentionProjectionSummary,
  compareCampaignAttentionItems,
  parseCampaignAttentionProjection,
  type CampaignAttentionProjectionV1,
} from '../../../shared/campaignAttention/projection'
import {
  parseCampaignAttentionItem,
  type CampaignAttentionAuthorityRef,
  type CampaignAttentionItem,
} from '../../../shared/campaignAttention/model'
import { isSlug } from '../../../shared/paths'
import type { AuthRole } from '../../../shared/auth'
import type { StoredSheetDocument } from '../../storage/sheetRepository'

const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const sameAuthority = (left: CampaignAttentionAuthorityRef, right: CampaignAttentionAuthorityRef): boolean => (
  left.kind === right.kind && left.id === right.id && left.revision === right.revision
)

const assertItemAuthorityIntegrity = (item: CampaignAttentionItem): void => {
  if (item.requiredDecision && !sameAuthority(item.requiredDecision.authority, item.authority)) {
    throw new Error('Campaign attention decision authority must match its item authority.')
  }
  if (item.legalActions.some(action => !sameAuthority(action.authority, item.authority))) {
    throw new Error('Campaign attention action authority must match its item authority.')
  }
}

export const mergeCampaignAttentionItems = (
  providers: readonly (readonly CampaignAttentionItem[])[],
): readonly CampaignAttentionItem[] => {
  const byId = new Map<string, CampaignAttentionItem>()
  for (const [providerIndex, provider] of providers.entries()) {
    if (!Array.isArray(provider) || provider.length > CAMPAIGN_ATTENTION_PROJECTION_LIMIT) {
      throw new Error(`Campaign attention provider ${providerIndex} must be complete and bounded to ${CAMPAIGN_ATTENTION_PROJECTION_LIMIT} items.`)
    }
    for (const [itemIndex, raw] of provider.entries()) {
      const item = parseCampaignAttentionItem(raw, `providers[${providerIndex}][${itemIndex}]`)
      assertItemAuthorityIntegrity(item)
      const existing = byId.get(item.itemId)
      if (existing && !same(existing, item)) {
        throw new Error('Campaign attention providers produced a divergent duplicate item identity.')
      }
      byId.set(item.itemId, item)
    }
  }
  if (byId.size > CAMPAIGN_ATTENTION_PROJECTION_LIMIT) {
    throw new Error(`Merged campaign attention is bounded to ${CAMPAIGN_ATTENTION_PROJECTION_LIMIT} items.`)
  }
  return Object.freeze([...byId.values()].sort(compareCampaignAttentionItems))
}

interface CurrentSheetAuthority {
  readonly kind: 'pokemon' | 'trainer'
  readonly slug: string
  readonly revision: number
  readonly document: Record<string, unknown>
}

const currentSheets = (sheets: readonly StoredSheetDocument[]): readonly CurrentSheetAuthority[] => {
  if (sheets.length > CAMPAIGN_ATTENTION_PROJECTION_LIMIT) {
    throw new Error(`Campaign attention role projection is bounded to ${CAMPAIGN_ATTENTION_PROJECTION_LIMIT} sheets.`)
  }
  const keys = sheets.map(sheet => `${sheet.kind}:${sheet.slug}`)
  if (new Set(keys).size !== keys.length) {
    throw new Error('Campaign attention role projection requires unique current sheet authority.')
  }
  return Object.freeze(sheets.map((sheet) => {
    if (!isSlug(sheet.slug) || !Number.isSafeInteger(sheet.revision) || sheet.revision < 0
      || typeof sheet.document !== 'object' || sheet.document === null || Array.isArray(sheet.document)) {
      throw new Error('Campaign attention role projection requires valid exact current sheet authority.')
    }
    return Object.freeze({
      kind: sheet.kind,
      slug: sheet.slug,
      revision: sheet.revision,
      document: sheet.document as Record<string, unknown>,
    })
  }))
}

const exactRoster = (value: unknown): readonly string[] | null => {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value) || value.length > CAMPAIGN_ATTENTION_PROJECTION_LIMIT
    || value.some(slug => !isSlug(slug) || slug.length > 160)
    || new Set(value).size !== value.length) return null
  return Object.freeze([...value] as string[])
}

const ownedSheetKeys = (input: {
  readonly profile: PlayerProfile
  readonly sheets: readonly CurrentSheetAuthority[]
}): ReadonlySet<string> => {
  const existing = new Set(input.sheets.map(sheet => `${sheet.kind}:${sheet.slug}`))
  const keys = new Set<string>()
  for (const link of input.profile.linkedCharacters) {
    const key = `${link.sheetKind}:${link.sheetSlug}`
    if (existing.has(key)) keys.add(key)
  }
  const linkedTrainerSlugs = new Set(input.profile.linkedCharacters
    .filter(link => link.sheetKind === 'trainer')
    .map(link => link.sheetSlug))
  for (const trainer of input.sheets.filter(sheet => sheet.kind === 'trainer' && linkedTrainerSlugs.has(sheet.slug))) {
    const team = exactRoster(trainer.document.currentTeam)
    const box = exactRoster(trainer.document.boxedPokemon)
    if (!team || !box || team.some(slug => box.includes(slug))) continue
    for (const slug of [...team, ...box]) {
      if (existing.has(`pokemon:${slug}`)) keys.add(`pokemon:${slug}`)
    }
  }
  return keys
}

const itemSheetKey = (
  item: CampaignAttentionItem,
  sheets: readonly CurrentSheetAuthority[],
): string | null => {
  if (item.entity.kind === 'trainer-sheet') return `trainer:${item.entity.id}`
  if (item.entity.kind === 'pokemon-sheet') return `pokemon:${item.entity.id}`
  if (item.authority.kind !== 'sheet') return null
  const candidates = sheets.filter(sheet => sheet.slug === item.authority.id)
  return candidates.length === 1 ? `${candidates[0]!.kind}:${candidates[0]!.slug}` : null
}

export const projectCampaignAttentionForViewer = (input: {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly sheets: readonly StoredSheetDocument[]
  readonly campaignMinute: number
  readonly items: readonly CampaignAttentionItem[]
}): CampaignAttentionProjectionV1 => {
  if (!Number.isSafeInteger(input.campaignMinute) || input.campaignMinute < 0) {
    throw new Error('Campaign attention projection requires current non-negative campaign time.')
  }
  const sheets = currentSheets(input.sheets)
  const merged = mergeCampaignAttentionItems([input.items])
  const open = merged.filter(item => item.resolution.state === 'open')
  let visible: readonly CampaignAttentionItem[]
  let profileAuthorityHash: string | null = null
  if (input.role === 'gm') {
    if (input.playerProfile !== undefined && input.playerProfile !== null) {
      throw new Error('GM campaign attention projection rejects Player Profile authority.')
    }
    visible = open
  }
  else {
    if (!input.playerProfile) {
      visible = Object.freeze([])
    }
    else {
      const profile = normalizePlayerProfile(input.playerProfile)
      if (!same(profile, input.playerProfile)) {
        throw new Error('Player campaign attention projection requires exact normalized Profile authority.')
      }
      profileAuthorityHash = hash(profile)
      const owned = ownedSheetKeys({ profile, sheets })
      visible = Object.freeze(open.flatMap((item) => {
        if (item.audience !== 'owner') return []
        if (item.entity.kind === 'profile') {
          if (item.entity.id !== profile.id) return []
          return [parseCampaignAttentionItem({
            ...item,
            entity: { kind: 'campaign', id: 'campaign' },
          })]
        }
        const key = itemSheetKey(item, sheets)
        return key !== null && owned.has(key) ? [item] : []
      }))
    }
  }
  const items = Object.freeze([...visible].sort(compareCampaignAttentionItems))
  const scope = input.role === 'gm' ? 'gm' as const : 'owner' as const
  const snapshotId = `campaign-attention-snapshot:v1:${hash({
    schemaVersion: 1,
    scope,
    profileAuthorityHash,
    campaignMinute: input.campaignMinute,
    items,
  })}`
  return parseCampaignAttentionProjection({
    schemaVersion: 1,
    snapshotId,
    scope,
    campaignMinute: input.campaignMinute,
    items,
    summary: campaignAttentionProjectionSummary(items),
  })
}
