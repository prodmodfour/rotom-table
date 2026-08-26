import {
  GM_CAMPAIGN_TOOLKIT_CHANNEL,
  type GmCampaignToolkitInvalidationV1,
} from '#shared/gmToolkit/realtime'
import { publishTransientRealtime } from './realtime'

export { GM_CAMPAIGN_TOOLKIT_CHANNEL } from '#shared/gmToolkit/realtime'

export const publishGmCampaignToolkitInvalidation = (
  invalidation: GmCampaignToolkitInvalidationV1,
  _operationId?: string,
): void => {
  publishTransientRealtime({
    access: { kind: 'gm-only' },
    event: {
      channel: GM_CAMPAIGN_TOOLKIT_CHANNEL,
      type: `${invalidation.domain}-invalidated`,
      revision: invalidation.revision,
      data: { documentId: invalidation.documentId, revision: invalidation.revision },
    },
  })
}
