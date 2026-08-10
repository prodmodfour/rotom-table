<script setup lang="ts">
import {
  PhArrowClockwise,
  PhBell,
  PhCheckCircle,
  PhGift,
  PhShieldCheck,
  PhWarning,
  PhX,
} from '@phosphor-icons/vue'
import { computed, nextTick, ref, watch } from 'vue'
import type {
  BreedingConsentWorkflowEggTransferV1,
  BreedingConsentWorkflowProjectRequestV1,
  BreedingConsentWorkflowProjectionV1,
} from '#shared/breeding/consentWorkflow'

const props = defineProps<{
  projection: BreedingConsentWorkflowProjectionV1 | null
  loading: boolean
  submitting: boolean
  error: string | null
  transferSetup: { readonly eggId: string, readonly eggRevision: number } | null
}>()
const emit = defineEmits<{
  retry: []
  grantProjectConsent: [card: BreedingConsentWorkflowProjectRequestV1]
  revokeProjectConsent: [card: BreedingConsentWorkflowProjectRequestV1]
  cancelProjectAsGm: [card: BreedingConsentWorkflowProjectRequestV1]
  closeTransferSetup: []
  offerEggTransfer: [destinationTrainerSlug: string]
  acceptEggTransfer: [card: BreedingConsentWorkflowEggTransferV1]
  revokeEggTransferConsent: [card: BreedingConsentWorkflowEggTransferV1]
  completeEggTransfer: [card: BreedingConsentWorkflowEggTransferV1]
}>()

const destinationTrainerSlug = ref('')
const destinationInput = ref<HTMLInputElement | null>(null)
const hasCards = computed(() => Boolean(
  props.projection && (props.projection.projectRequests.length || props.projection.eggTransfers.length),
))
const destinationValid = computed(() => /^[a-z0-9-]+$/u.test(destinationTrainerSlug.value)
  && destinationTrainerSlug.value !== props.projection?.context.trainerSheetSlug)
const scopeLabel = (scope: string): string => ({
  'own-parent-contribution-attribution': 'Attribute this parent’s contribution',
  'own-parent-safe-summary': 'Show this parent’s safe Project summary',
  'project-participation': 'Use this parent in this Project revision',
})[scope] ?? 'Project participation'
const consentStatusLabel = (status: BreedingConsentWorkflowProjectRequestV1['consent']['status']): string => ({
  active: 'Consent active',
  expired: 'Consent expired',
  revoked: 'Consent revoked',
  stale: 'Parent changed',
  waiting: 'Your decision is required',
})[status]
const transferStateLabel = (state: BreedingConsentWorkflowEggTransferV1['state']): string => ({
  accepted: 'Both approvals recorded',
  expired: 'Offer expired',
  offered: 'Waiting for recipient approval',
  revoked: 'Approval revoked',
  transferred: 'Transfer complete',
})[state]
const transitionMessages = {
  'egg-transfer-accepted': 'Your recipient acceptance was recorded.',
  'egg-transfer-consent-revoked': 'Your Egg-transfer consent was revoked.',
  'egg-transfer-offered': 'Your private Egg gift offer was recorded.',
  'egg-transferred': 'The accepted Egg transfer completed atomically.',
  'exact-replay': 'The server confirmed the previously accepted result.',
  'project-cancelled-by-gm': 'The GM cancelled the Project with an audited recovery action.',
  'project-consent-granted': 'Your Project consent was recorded.',
  'project-consent-revoked': 'Your Project consent was revoked and the active Project ended.',
} as const
const transitionMessage = computed(() => {
  const transition = props.projection?.transition
  return transition && transition in transitionMessages
    ? transitionMessages[transition as keyof typeof transitionMessages]
    : ''
})

watch(() => props.transferSetup, async (value) => {
  destinationTrainerSlug.value = ''
  if (value) {
    await nextTick()
    destinationInput.value?.focus()
  }
})
const submitOffer = (): void => {
  if (destinationValid.value && !props.submitting) emit('offerEggTransfer', destinationTrainerSlug.value)
}
</script>

<template>
  <section
    class="breeding-consent-center"
    aria-labelledby="breeding-consent-center-title"
    :aria-busy="loading || submitting"
  >
    <header class="breeding-consent-center__header">
      <div class="breeding-consent-center__title">
        <PhShieldCheck :size="24" weight="duotone" aria-hidden="true" />
        <div>
          <p class="breeding-consent-center__eyebrow">Private authority</p>
          <h2 id="breeding-consent-center-title">Consent center</h2>
        </div>
      </div>
      <span v-if="projection" class="breeding-consent-center__notifications" aria-label="Private consent notifications">
        <PhBell :size="18" weight="fill" aria-hidden="true" />
        {{ projection.notifications.total }}
      </span>
    </header>

    <div v-if="loading && !projection" class="breeding-consent-state" role="status" aria-live="polite">
      <PhShieldCheck :size="24" weight="duotone" aria-hidden="true" />
      <div>
        <h3>Loading private decisions</h3>
        <p>Rebuilding current Profile, Trainer, Project, Egg, revision, and campaign-time authority…</p>
      </div>
    </div>

    <div v-else-if="error" class="breeding-consent-state breeding-consent-state--error" role="alert">
      <PhWarning :size="24" weight="duotone" aria-hidden="true" />
      <div>
        <h3>Consent authority is unavailable</h3>
        <p>{{ error }}</p>
      </div>
      <button type="button" class="breeding-consent-button breeding-consent-button--secondary" @click="emit('retry')">
        <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
        Refresh decisions
      </button>
    </div>

    <template v-else-if="projection">
      <p v-if="transitionMessage" class="breeding-consent-center__announcement" role="status" aria-live="polite">
        <PhCheckCircle :size="18" weight="fill" aria-hidden="true" />
        {{ transitionMessage }}
      </p>

      <aside v-if="projection.gmPolicy" class="breeding-consent-policy" data-testid="breeding-consent-gm-policy">
        <PhShieldCheck :size="22" weight="duotone" aria-hidden="true" />
        <div>
          <strong>GM authority has a strict boundary</strong>
          <p>
            A reviewed setup override may create the consent-gated Project, and an audited recovery control may cancel it.
            Neither action creates participant consent. Egg transfer always requires separate positive source and recipient approvals.
          </p>
        </div>
      </aside>

      <div v-if="!hasCards" class="breeding-consent-state" data-testid="breeding-consent-empty">
        <PhShieldCheck :size="24" weight="duotone" aria-hidden="true" />
        <div>
          <h3>No private decisions need attention</h3>
          <p>This view contains only decisions authorized for {{ projection.context.displayName }}.</p>
        </div>
      </div>

      <section v-if="projection.projectRequests.length" class="breeding-consent-group" aria-labelledby="breeding-project-consent-title">
        <div class="breeding-consent-group__heading">
          <h3 id="breeding-project-consent-title">Cross-owner Project consent</h3>
          <span>{{ projection.projectRequests.length }}</span>
        </div>
        <p class="breeding-consent-group__intro">
          Project consent is separate from Egg gifting. It is bound to this parent, sheet revision, Trainer, Profile, Project revision, scopes, and campaign time.
        </p>
        <p v-if="projection.projectRequestsTruncated" class="breeding-consent-center__bounded">
          Showing the 50 newest current requests. Refresh after resolving a decision.
        </p>
        <div class="breeding-consent-grid">
          <article
            v-for="(card, index) in projection.projectRequests"
            :key="`${card.projectId}-${card.ownParent.pokemonSheetSlug}`"
            class="breeding-consent-card"
            :aria-labelledby="`breeding-project-consent-${index}`"
          >
            <header>
              <div>
                <p class="breeding-consent-card__kind">Participating parent</p>
                <h4 :id="`breeding-project-consent-${index}`">{{ card.ownParent.displayName }}</h4>
              </div>
              <span class="breeding-consent-card__status" :data-status="card.consent.status">
                {{ consentStatusLabel(card.consent.status) }}
              </span>
            </header>
            <p class="breeding-consent-card__meta">
              Breeder: <strong>{{ card.breederDisplayName }}</strong>
              <span aria-hidden="true">·</span>
              Project revision {{ card.projectRevision }}
            </p>
            <p v-if="!card.ownParent.current" class="breeding-consent-card__warning" role="status">
              The participating parent revision changed. This request cannot be accepted.
            </p>
            <ul class="breeding-consent-card__scopes" aria-label="Requested consent scopes">
              <li v-for="scope in card.consent.scopes" :key="scope">{{ scopeLabel(scope) }}</li>
            </ul>
            <p v-if="card.consent.expiresAtCampaignMinute !== null" class="breeding-consent-card__expiry">
              Campaign-time expiry: minute {{ card.consent.expiresAtCampaignMinute }}
            </p>
            <aside v-if="card.recovery.state === 'pending'" class="breeding-consent-card__recovery" role="status">
              <PhWarning :size="19" weight="duotone" aria-hidden="true" />
              <div>
                <strong>System recovery required</strong>
                <p>Refresh current authority before repeating this decision. No command payload is exposed.</p>
              </div>
            </aside>
            <p v-else-if="card.consent.status === 'expired'" class="breeding-consent-card__warning">
              Campaign-time expiry must be settled by the audited lifecycle authority before a new grant.
            </p>
            <div class="breeding-consent-card__actions">
              <button
                v-if="card.canGrant"
                type="button"
                class="breeding-consent-button"
                :disabled="submitting"
                @click="emit('grantProjectConsent', card)"
              >
                <PhCheckCircle :size="18" weight="fill" aria-hidden="true" />
                Give scoped consent
              </button>
              <button
                v-if="card.canRevoke"
                type="button"
                class="breeding-consent-button breeding-consent-button--danger"
                :disabled="submitting"
                @click="emit('revokeProjectConsent', card)"
              >
                Revoke my consent
              </button>
              <button
                v-if="card.gmReview?.canCancelProject"
                type="button"
                class="breeding-consent-button breeding-consent-button--danger"
                :disabled="submitting"
                @click="emit('cancelProjectAsGm', card)"
              >
                Cancel Project (audited)
              </button>
            </div>
            <p v-if="card.gmReview" class="breeding-consent-card__boundary">
              Setup/recovery control only · positive consent substitution forbidden
            </p>
          </article>
        </div>
      </section>

      <section v-if="projection.eggTransfers.length" class="breeding-consent-group" aria-labelledby="breeding-transfer-consent-title">
        <div class="breeding-consent-group__heading">
          <h3 id="breeding-transfer-consent-title">Egg transfer consent</h3>
          <span>{{ projection.eggTransfers.length }}</span>
        </div>
        <p class="breeding-consent-group__intro">
          Only current positive gift and acceptance records can authorize transfer. Opening or reviewing a card never changes ownership.
        </p>
        <p v-if="projection.eggTransfersTruncated" class="breeding-consent-center__bounded">
          Showing a bounded private transfer view.
        </p>
        <div class="breeding-consent-grid">
          <article
            v-for="(card, index) in projection.eggTransfers"
            :key="`${card.offerConsentId}-${card.audience}`"
            class="breeding-consent-card"
            :aria-labelledby="`breeding-transfer-consent-${index}`"
          >
            <header>
              <div>
                <p class="breeding-consent-card__kind">{{ card.audience === 'recipient' ? 'Private invitation' : 'Your gift offer' }}</p>
                <h4 :id="`breeding-transfer-consent-${index}`">Egg transfer</h4>
              </div>
              <span class="breeding-consent-card__status" :data-status="card.state">{{ transferStateLabel(card.state) }}</span>
            </header>
            <p class="breeding-consent-card__meta">Egg revision {{ card.eggRevision }}</p>
            <p class="breeding-consent-card__expiry">Campaign-time expiry: minute {{ card.expiresAtCampaignMinute }}</p>
            <aside v-if="card.recovery.state === 'pending'" class="breeding-consent-card__recovery" role="status">
              <PhWarning :size="19" weight="duotone" aria-hidden="true" />
              <div>
                <strong>System recovery required</strong>
                <p>Refresh accepted state before another ownership action.</p>
              </div>
            </aside>
            <div class="breeding-consent-card__actions">
              <button
                v-if="card.canAccept"
                type="button"
                class="breeding-consent-button"
                :disabled="submitting"
                @click="emit('acceptEggTransfer', card)"
              >
                Accept this Egg gift
              </button>
              <button
                v-if="card.canTransfer"
                type="button"
                class="breeding-consent-button"
                :disabled="submitting"
                @click="emit('completeEggTransfer', card)"
              >
                Complete accepted transfer
              </button>
              <button
                v-if="card.canRevoke"
                type="button"
                class="breeding-consent-button breeding-consent-button--danger"
                :disabled="submitting"
                @click="emit('revokeEggTransferConsent', card)"
              >
                {{ card.state === 'expired' ? 'Settle campaign-time expiry' : 'Revoke my transfer consent' }}
              </button>
            </div>
          </article>
        </div>
      </section>
    </template>

    <div
      v-if="transferSetup"
      class="breeding-consent-dialog-backdrop"
      role="presentation"
      @click.self="emit('closeTransferSetup')"
    >
      <section
        class="breeding-consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="breeding-transfer-setup-title"
        @keydown.esc="emit('closeTransferSetup')"
      >
        <header>
          <div>
            <p class="breeding-consent-center__eyebrow">Non-mutating setup</p>
            <h2 id="breeding-transfer-setup-title">Offer an Egg gift</h2>
          </div>
          <button type="button" class="breeding-consent-dialog__close" aria-label="Close transfer setup" @click="emit('closeTransferSetup')">
            <PhX :size="20" aria-hidden="true" />
          </button>
        </header>
        <p>
          Enter the intended recipient Trainer slug. This records only your source gift consent; ownership remains unchanged until that Trainer’s current Profile gives separate acceptance.
        </p>
        <form @submit.prevent="submitOffer">
          <label>
            <span>Recipient Trainer slug</span>
            <input
              ref="destinationInput"
              v-model.trim="destinationTrainerSlug"
              name="destinationTrainerSlug"
              inputmode="text"
              autocomplete="off"
              pattern="[a-z0-9-]+"
              required
              :aria-invalid="destinationTrainerSlug.length > 0 && !destinationValid"
            >
          </label>
          <p v-if="destinationTrainerSlug === projection?.context.trainerSheetSlug" class="breeding-consent-card__warning" role="alert">
            Choose a different Trainer. Egg gifts cannot transfer to the current owner.
          </p>
          <div class="breeding-consent-dialog__actions">
            <button type="button" class="breeding-consent-button breeding-consent-button--secondary" @click="emit('closeTransferSetup')">Cancel</button>
            <button type="submit" class="breeding-consent-button" :disabled="!destinationValid || submitting">
              <PhGift :size="18" weight="fill" aria-hidden="true" />
              {{ submitting ? 'Recording gift…' : 'Give source consent' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </section>
</template>

<style scoped>
.breeding-consent-center {
  display: grid;
  gap: 1rem;
  color: var(--rt-text);
}
.breeding-consent-center__header,
.breeding-consent-state,
.breeding-consent-policy,
.breeding-consent-card {
  border: 1px solid var(--rt-rule);
  background: var(--rt-surface-1);
  box-shadow: var(--rt-elevation-1);
}
.breeding-consent-center__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.2rem;
  border-radius: var(--rt-radius-medium);
}
.breeding-consent-center__title,
.breeding-consent-center__title > div,
.breeding-consent-group__heading,
.breeding-consent-card > header,
.breeding-consent-card__actions,
.breeding-consent-center__announcement,
.breeding-consent-policy,
.breeding-consent-state,
.breeding-consent-button {
  display: flex;
  align-items: center;
}
.breeding-consent-center__title { gap: 0.7rem; }
.breeding-consent-center__title > div { align-items: flex-start; flex-direction: column; }
.breeding-consent-center h2,
.breeding-consent-center h3,
.breeding-consent-center h4,
.breeding-consent-center p { margin-top: 0; }
.breeding-consent-center h2 { margin-bottom: 0; font-size: 1.3rem; color: var(--rt-text-strong); }
.breeding-consent-center h3 { margin-bottom: 0.35rem; color: var(--rt-text-strong); }
.breeding-consent-center h4 { margin-bottom: 0; color: var(--rt-text-strong); font-size: 1.05rem; }
.breeding-consent-center__eyebrow,
.breeding-consent-card__kind {
  margin-bottom: 0.15rem;
  color: var(--rt-focus);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.breeding-consent-center__notifications {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 2.5rem;
  justify-content: center;
  padding: 0.4rem 0.65rem;
  border-radius: 999px;
  background: var(--rt-focus-soft);
  color: var(--rt-text-strong);
  font-weight: 800;
}
.breeding-consent-state,
.breeding-consent-policy { gap: 0.85rem; padding: 1rem 1.2rem; border-radius: var(--rt-radius-medium); }
.breeding-consent-state { min-height: 6.5rem; }
.breeding-consent-state > div,
.breeding-consent-policy > div { flex: 1; min-width: 0; }
.breeding-consent-state p,
.breeding-consent-policy p,
.breeding-consent-group__intro { margin-bottom: 0; color: var(--rt-text-muted); line-height: 1.5; }
.breeding-consent-state--error { border-color: var(--rt-danger); }
.breeding-consent-policy { border-color: var(--rt-pending); align-items: flex-start; }
.breeding-consent-center__announcement {
  gap: 0.5rem;
  margin: 0;
  padding: 0.8rem 1rem;
  border-radius: var(--rt-radius-small);
  background: var(--rt-success-soft);
  color: var(--rt-text-strong);
}
.breeding-consent-group { display: grid; gap: 0.75rem; }
.breeding-consent-group__heading { justify-content: space-between; gap: 1rem; }
.breeding-consent-group__heading > span {
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: var(--rt-surface-2);
  font-variant-numeric: tabular-nums;
}
.breeding-consent-center__bounded { margin-bottom: 0; color: var(--rt-pending); }
.breeding-consent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: 0.8rem; }
.breeding-consent-card { display: grid; align-content: start; gap: 0.75rem; padding: 1rem; border-radius: var(--rt-radius-medium); }
.breeding-consent-card > header { justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
.breeding-consent-card__status {
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--rt-rule);
  border-radius: 999px;
  color: var(--rt-text-muted);
  font-size: 0.78rem;
  white-space: nowrap;
}
.breeding-consent-card__status[data-status="waiting"],
.breeding-consent-card__status[data-status="offered"] { border-color: var(--rt-pending); color: var(--rt-pending); }
.breeding-consent-card__status[data-status="active"],
.breeding-consent-card__status[data-status="accepted"] { border-color: var(--rt-success); color: var(--rt-success); }
.breeding-consent-card__meta,
.breeding-consent-card__expiry,
.breeding-consent-card__boundary { margin-bottom: 0; color: var(--rt-text-muted); font-size: 0.86rem; }
.breeding-consent-card__scopes { display: grid; gap: 0.3rem; margin: 0; padding-left: 1.25rem; color: var(--rt-text-muted); }
.breeding-consent-card__warning { margin-bottom: 0; color: var(--rt-danger); font-weight: 650; }
.breeding-consent-card__recovery { display: flex; gap: 0.55rem; padding: 0.7rem; border: 1px solid var(--rt-pending); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); }
.breeding-consent-card__recovery p { margin: 0.2rem 0 0; color: var(--rt-text-muted); font-size: 0.84rem; }
.breeding-consent-card__actions { flex-wrap: wrap; align-items: stretch; gap: 0.55rem; }
.breeding-consent-button {
  justify-content: center;
  gap: 0.4rem;
  min-height: 2.65rem;
  padding: 0.55rem 0.85rem;
  border: 1px solid transparent;
  border-radius: var(--rt-radius-small);
  background: var(--rt-focus);
  color: var(--rt-on-focus);
  font: inherit;
  font-weight: 750;
  cursor: pointer;
}
.breeding-consent-button--secondary { border-color: var(--rt-rule); background: var(--rt-surface-2); color: var(--rt-text-strong); }
.breeding-consent-button--danger { border-color: var(--rt-danger); background: transparent; color: var(--rt-danger); }
.breeding-consent-button:disabled { cursor: wait; opacity: 0.55; }
.breeding-consent-button:focus-visible,
.breeding-consent-dialog__close:focus-visible,
.breeding-consent-dialog input:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 3px; }
.breeding-consent-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 1rem;
  overflow: auto;
  background: color-mix(in srgb, var(--rt-bg-canvas) 72%, transparent);
}
.breeding-consent-dialog {
  width: min(100%, 35rem);
  padding: 1.1rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-large);
  background: var(--rt-surface-1);
  box-shadow: var(--rt-elevation-3);
}
.breeding-consent-dialog > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.breeding-consent-dialog > p { color: var(--rt-text-muted); line-height: 1.5; }
.breeding-consent-dialog__close { display: grid; place-items: center; min-width: 2.75rem; min-height: 2.75rem; border: 0; border-radius: var(--rt-radius-small); background: transparent; color: var(--rt-text); cursor: pointer; }
.breeding-consent-dialog form,
.breeding-consent-dialog label { display: grid; gap: 0.45rem; }
.breeding-consent-dialog label > span { color: var(--rt-text-strong); font-weight: 700; }
.breeding-consent-dialog input { min-height: 2.8rem; padding: 0.55rem 0.7rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text); font: inherit; }
.breeding-consent-dialog__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 0.6rem; margin-top: 0.9rem; }
@media (max-width: 560px) {
  .breeding-consent-center__header,
  .breeding-consent-card > header { align-items: flex-start; }
  .breeding-consent-card__actions,
  .breeding-consent-dialog__actions { display: grid; }
  .breeding-consent-card__actions > *,
  .breeding-consent-dialog__actions > * { width: 100%; }
  .breeding-consent-dialog-backdrop { place-items: end stretch; padding: 0; }
  .breeding-consent-dialog { width: 100%; max-height: 92dvh; overflow: auto; border-radius: var(--rt-radius-large) var(--rt-radius-large) 0 0; }
}
@media (prefers-reduced-motion: reduce) {
  .breeding-consent-center * { scroll-behavior: auto !important; transition: none !important; }
}
</style>
