import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseCampaignOperationOfferV1,
  type CampaignOperationOfferV1,
} from '#shared/campaignOperationOffers'

export type CampaignOperationOfferDefinitionV1 = Omit<
  CampaignOperationOfferV1,
  'schemaVersion' | 'offerId' | 'offerDefinitionSha256'
>

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const definitionWithoutHash = (
  offer: CampaignOperationOfferV1,
): Omit<CampaignOperationOfferV1, 'offerDefinitionSha256'> => {
  const { offerDefinitionSha256: _definitionSha256, ...definition } = offer
  return definition
}

export const parseAuthoritativeCampaignOperationOfferV1 = (
  value: unknown,
  path = 'campaignOperationOffer',
): CampaignOperationOfferV1 => {
  const offer = parseCampaignOperationOfferV1(value, path)
  if (sha256(definitionWithoutHash(offer)) !== offer.offerDefinitionSha256) {
    throw new Error(`${path}.offerDefinitionSha256 does not match the strict campaign-operation offer.`)
  }
  return offer
}

export const createCampaignOperationOfferV1 = (input: {
  readonly identityMaterial: unknown
  readonly definition: CampaignOperationOfferDefinitionV1
}): CampaignOperationOfferV1 => {
  const offerId = `campaign-operation-offer:v1:${sha256(input.identityMaterial).slice(0, 32)}`
  const definition = {
    schemaVersion: 1 as const,
    offerId,
    ...input.definition,
  }
  return parseAuthoritativeCampaignOperationOfferV1({
    ...definition,
    offerDefinitionSha256: sha256(definition),
  })
}

export const assertCampaignOperationOfferExactReplayV1 = (
  existingValue: unknown,
  replayedValue: unknown,
): CampaignOperationOfferV1 => {
  const existing = parseAuthoritativeCampaignOperationOfferV1(existingValue, 'existingOffer')
  const replayed = parseAuthoritativeCampaignOperationOfferV1(replayedValue, 'replayedOffer')
  if (existing.offerId !== replayed.offerId
    || stableJsonStringify(existing) !== stableJsonStringify(replayed)) {
    throw new Error('Campaign-operation offer identities permit exact stable-JSON replay only.')
  }
  return existing
}
