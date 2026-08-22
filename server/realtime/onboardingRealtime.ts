import type { PlayerProfileId } from '#shared/playerProfiles'
import {
  onboardingGmChannel,
  onboardingProfileChannel,
  type OnboardingDraftChangedPayloadV1,
  type OnboardingPolicyPublishedPayloadV1,
  type OnboardingSlotChangedPayloadV1,
} from '#shared/onboarding/realtime'
import {
  publishTransientRealtime,
  type TransientRealtimePublicationInput,
} from '../utils/realtime'

type Publish = (publication: TransientRealtimePublicationInput) => void

/** GM aggregate: queue/slot state changed. */
export const publishOnboardingSlotChanged = (
  payload: OnboardingSlotChangedPayloadV1,
  publish: Publish = publishTransientRealtime,
): void => {
  publish({
    event: {
      channel: onboardingGmChannel,
      type: 'onboarding.slot.changed',
      data: payload,
    },
    access: { kind: 'gm-only' },
  })
}

/** Owner: durable draft changed (other tab/device, review transition, GM action). */
export const publishOnboardingDraftChanged = (
  profileId: PlayerProfileId,
  payload: OnboardingDraftChangedPayloadV1,
  publish: Publish = publishTransientRealtime,
): void => {
  publish({
    event: {
      channel: onboardingProfileChannel(profileId),
      type: 'onboarding.draft.changed',
      data: payload,
    },
    access: { kind: 'player-profile-access', profileId },
  })
}

/** GM aggregate: a policy version was published. */
export const publishOnboardingPolicyPublished = (
  payload: OnboardingPolicyPublishedPayloadV1,
  publish: Publish = publishTransientRealtime,
): void => {
  publish({
    event: {
      channel: onboardingGmChannel,
      type: 'onboarding.policy.published',
      data: payload,
    },
    access: { kind: 'gm-only' },
  })
}
