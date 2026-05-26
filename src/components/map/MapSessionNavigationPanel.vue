<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSessionLobby } from '~/composables/useSessionLobby'
import { buildMapSessionAttachmentActionModel } from '~/utils/mapSessionAttachmentAction'
import { buildMapSessionNavigationModel } from '~/utils/mapSessionNavigation'
import {
  buildSessionTokenAssignmentPanelModel,
  type SessionTokenAssignmentAction,
  type SessionTokenAssignmentTokenInput,
} from '~/utils/sessionTokenAssignmentPanel'
import type { PlayerId } from '#shared/sessionIdentity'
import type { SessionTokenResourceRef } from '#shared/sessionPermissions'

const props = withDefaults(defineProps<{
  mapSlug?: string | null
  sessionModeEnabled?: boolean
  mapTokens?: readonly SessionTokenAssignmentTokenInput[]
}>(), {
  mapSlug: null,
  sessionModeEnabled: false,
  mapTokens: () => [],
})

type PanelFeedbackKind = 'notice' | 'error'

interface PanelFeedback {
  readonly kind: PanelFeedbackKind
  readonly message: string
}

const { isGm } = useAuth()
const {
  identity,
  gmManagement,
  lastAttachedSessionMap,
  busy,
  lastError,
  lastNotice,
  attachMapToSession,
  assignSessionMapTokenToPlayer,
  unassignSessionMapTokenFromPlayer,
  loadRememberedIdentity,
} = useSessionLobby()

const attachFeedback = ref<PanelFeedback | null>(null)
const assignmentFeedback = ref<PanelFeedback | null>(null)

const model = computed(() => buildMapSessionNavigationModel({
  mapSlug: props.mapSlug,
  sessionModeEnabled: props.sessionModeEnabled,
}))

const currentAttachedMapSlug = computed(() => {
  const mapSlug = props.mapSlug?.trim()
  if (!mapSlug) return null
  if (lastAttachedSessionMap.value?.map.mapSlug === mapSlug) return mapSlug
  return gmManagement.value?.maps.find((sessionMap) => sessionMap.mapSlug === mapSlug)?.mapSlug ?? null
})

const attachmentModel = computed(() => buildMapSessionAttachmentActionModel({
  mapSlug: props.mapSlug,
  sessionModeEnabled: props.sessionModeEnabled,
  localRoleIsGm: isGm.value,
  rememberedRole: identity.value?.role ?? null,
  busy: busy.value,
  attachedMapSlug: currentAttachedMapSlug.value,
  lastError: attachFeedback.value?.kind === 'error' ? attachFeedback.value.message : null,
  lastNotice: attachFeedback.value?.kind === 'notice' ? attachFeedback.value.message : null,
}))

const tokenAssignmentModel = computed(() => buildSessionTokenAssignmentPanelModel({
  mapSlug: props.mapSlug,
  selectedMapSlug: gmManagement.value?.session.selectedMapSlug ?? null,
  selectedMapAttached: gmManagement.value?.session.selectedMapAttached ?? false,
  sessionMapAvailable: gmManagement.value?.session.sessionMapAvailable ?? false,
  localRoleIsGm: isGm.value,
  rememberedRole: identity.value?.role ?? null,
  busy: busy.value,
  players: gmManagement.value?.players ?? [],
  assignments: gmManagement.value?.assignments ?? [],
  tokens: props.mapTokens,
}))

onMounted(() => {
  void loadRememberedIdentity({ refresh: true }).catch(() => undefined)
})

const attachCurrentMap = async () => {
  if (!attachmentModel.value.canAttach || attachmentModel.value.mapSlug === null) return

  attachFeedback.value = null
  assignmentFeedback.value = null

  try {
    await attachMapToSession({
      mapSlug: attachmentModel.value.mapSlug,
      selectedMapBehavior: 'select-attached-map',
      visibilityBehavior: 'visible-to-all-players',
    })
    attachFeedback.value = {
      kind: 'notice',
      message: lastNotice.value ?? `Attached ${attachmentModel.value.mapSlug} to the live session map.`,
    }
  } catch {
    attachFeedback.value = {
      kind: 'error',
      message: lastError.value ?? 'Could not attach the current map to the live session.',
    }
  }
}

const updateTokenControl = async (
  playerId: PlayerId,
  action: SessionTokenAssignmentAction,
  resource: SessionTokenResourceRef,
) => {
  if (!tokenAssignmentModel.value.canManage) return

  assignmentFeedback.value = null

  try {
    const updateAssignment = action === 'assign'
      ? assignSessionMapTokenToPlayer
      : unassignSessionMapTokenFromPlayer
    await updateAssignment({
      playerId,
      tokenId: resource.tokenId,
      mapSlug: resource.mapSlug ?? tokenAssignmentModel.value.selectedMapSlug ?? tokenAssignmentModel.value.mapSlug,
      sheetKind: resource.sheetKind ?? null,
      sheetSlug: resource.sheetSlug ?? null,
    })
    assignmentFeedback.value = {
      kind: 'notice',
      message: lastNotice.value ?? 'Updated live session token assignments.',
    }
  } catch {
    assignmentFeedback.value = {
      kind: 'error',
      message: lastError.value ?? 'Could not update live session token assignments.',
    }
  }
}
</script>

<template>
  <section class="map-session-navigation" aria-labelledby="map-session-navigation-title">
    <p class="map-session-navigation__eyebrow">Live session</p>
    <h2 id="map-session-navigation-title">{{ model.heading }}</h2>
    <p class="map-session-navigation__summary">{{ model.summary }}</p>
    <p
      class="map-session-navigation__status"
      :class="{ 'map-session-navigation__status--active': props.sessionModeEnabled }"
    >
      {{ model.statusLabel }}
    </p>

    <section class="map-session-attach" aria-labelledby="map-session-attach-title">
      <div class="map-session-attach__heading">
        <p>{{ attachmentModel.modeLabel }}</p>
        <h3 id="map-session-attach-title">Attach current map</h3>
      </div>
      <p class="map-session-attach__copy">{{ attachmentModel.modeSummary }}</p>
      <p
        class="map-session-attach__message"
        :class="`map-session-attach__message--${attachmentModel.statusKind}`"
        role="status"
      >
        {{ attachmentModel.statusMessage }}
      </p>
      <div class="map-session-attach__actions">
        <button
          type="button"
          class="map-session-attach__button"
          :disabled="!attachmentModel.canAttach"
          @click="attachCurrentMap"
        >
          {{ attachmentModel.attachButtonLabel }}
        </button>
        <NuxtLink
          v-if="attachmentModel.openSessionMapHref"
          :to="attachmentModel.openSessionMapHref"
          class="map-session-attach__link"
        >
          {{ attachmentModel.openSessionMapLabel }}
        </NuxtLink>
      </div>
    </section>

    <section class="map-session-assignments" aria-labelledby="map-session-assignments-title">
      <div class="map-session-assignments__heading">
        <p>Player access</p>
        <h3 id="map-session-assignments-title">{{ tokenAssignmentModel.heading }}</h3>
      </div>
      <p
        class="map-session-assignments__summary"
        :class="`map-session-assignments__summary--${tokenAssignmentModel.statusKind}`"
        role="status"
      >
        {{ tokenAssignmentModel.summary }}
      </p>
      <p
        v-if="assignmentFeedback"
        class="map-session-assignments__feedback"
        :class="`map-session-assignments__feedback--${assignmentFeedback.kind}`"
        role="status"
      >
        {{ assignmentFeedback.message }}
      </p>

      <div
        v-if="tokenAssignmentModel.players.length > 0 && tokenAssignmentModel.tokenCount > 0"
        class="map-session-assignments__players"
      >
        <article
          v-for="player in tokenAssignmentModel.players"
          :key="player.playerId"
          class="map-session-assignments__player"
        >
          <div class="map-session-assignments__player-heading">
            <h4>{{ player.displayName }}</h4>
            <small>{{ player.summary }}</small>
          </div>
          <ul class="map-session-assignments__tokens" aria-label="Current map token controls">
            <li v-for="token in player.tokens" :key="token.key">
              <span>
                <strong>{{ token.label }}</strong>
                <small>{{ token.description }}</small>
              </span>
              <button
                type="button"
                class="map-session-assignments__button"
                :class="{ 'map-session-assignments__button--assigned': token.assigned }"
                :disabled="token.disabled"
                :title="token.disabledReason ?? token.buttonLabel"
                @click="updateTokenControl(player.playerId, token.action, token.resource)"
              >
                {{ token.buttonLabel }}
              </button>
            </li>
          </ul>
        </article>
      </div>
    </section>

    <div class="map-session-navigation__links" aria-label="Live session navigation shortcuts">
      <NuxtLink
        v-for="link in model.links"
        :key="link.key"
        :to="link.to"
        class="map-session-navigation__link"
        :class="`map-session-navigation__link--${link.kind}`"
        :aria-label="`${link.label}. ${link.description}`"
      >
        <span>{{ link.label }}</span>
        <small>{{ link.description }}</small>
      </NuxtLink>
    </div>
  </section>
</template>

<style scoped>
.map-session-navigation {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.65rem;
  padding: 0.65rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
}

.map-session-navigation__eyebrow {
  margin: 0;
  color: var(--accent);
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.map-session-navigation h2,
.map-session-navigation__summary,
.map-session-navigation__status {
  margin: 0;
}

.map-session-navigation h2 {
  color: var(--ink-bright);
  font-size: 0.95rem;
  line-height: 1.2;
}

.map-session-navigation__summary,
.map-session-navigation__status,
.map-session-navigation__link small {
  color: var(--ink-soft);
  line-height: 1.35;
}

.map-session-navigation__summary {
  font-size: 0.76rem;
}

.map-session-navigation__status {
  padding: 0.45rem 0.5rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: rgba(143, 184, 255, 0.10);
  font-size: 0.72rem;
  font-weight: 700;
}

.map-session-navigation__status--active {
  border-color: rgba(70, 180, 122, 0.45);
  background: rgba(70, 180, 122, 0.12);
  color: var(--ink-bright);
}

.map-session-attach {
  display: grid;
  gap: 0.45rem;
  padding: 0.55rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
}

.map-session-attach__heading {
  display: grid;
  gap: 0.18rem;
}

.map-session-attach__heading p,
.map-session-attach__heading h3,
.map-session-attach__copy,
.map-session-attach__message {
  margin: 0;
}

.map-session-attach__heading p {
  color: var(--accent);
  font-size: 0.64rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.map-session-attach__heading h3 {
  color: var(--ink-bright);
  font-size: 0.82rem;
  line-height: 1.2;
}

.map-session-attach__copy,
.map-session-attach__message {
  color: var(--ink-soft);
  font-size: 0.68rem;
  line-height: 1.35;
}

.map-session-attach__message {
  padding: 0.42rem 0.46rem;
  border: 1px solid var(--rule-soft);
  border-radius: 9px;
  background: var(--paper-inset);
  font-weight: 700;
}

.map-session-attach__message--ready,
.map-session-attach__message--success {
  border-color: rgba(70, 180, 122, 0.45);
  background: rgba(70, 180, 122, 0.10);
  color: var(--ink-bright);
}

.map-session-attach__message--busy {
  border-color: rgba(143, 184, 255, 0.45);
  background: rgba(143, 184, 255, 0.10);
}

.map-session-attach__message--error {
  border-color: rgba(255, 31, 45, 0.55);
  background: rgba(255, 31, 45, 0.10);
  color: var(--accent);
}

.map-session-attach__actions {
  display: grid;
  gap: 0.4rem;
}

.map-session-attach__button,
.map-session-attach__link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 2.25rem;
  padding: 0.48rem 0.55rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 850;
  text-align: center;
}

.map-session-attach__button {
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}

.map-session-attach__button:disabled {
  background: var(--paper-soft);
  color: var(--ink-muted);
  cursor: not-allowed;
}

.map-session-attach__link {
  background: var(--paper-inset);
  color: var(--ink-bright);
  text-decoration: none;
}

.map-session-attach__button:not(:disabled):hover,
.map-session-attach__button:not(:disabled):focus-visible,
.map-session-attach__link:hover,
.map-session-attach__link:focus-visible {
  border-color: var(--accent);
  outline: none;
  transform: translateY(-1px);
}

.map-session-attach__button:not(:disabled):focus-visible,
.map-session-attach__link:focus-visible {
  outline: 2px solid rgba(255, 31, 45, 0.35);
  outline-offset: 2px;
}

.map-session-assignments {
  display: grid;
  gap: 0.45rem;
  padding: 0.55rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
}

.map-session-assignments__heading {
  display: grid;
  gap: 0.18rem;
}

.map-session-assignments__heading p,
.map-session-assignments__heading h3,
.map-session-assignments__summary,
.map-session-assignments__feedback,
.map-session-assignments__player-heading h4,
.map-session-assignments__player-heading small {
  margin: 0;
}

.map-session-assignments__heading p {
  color: var(--accent);
  font-size: 0.64rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.map-session-assignments__heading h3,
.map-session-assignments__player-heading h4 {
  color: var(--ink-bright);
  font-size: 0.82rem;
  line-height: 1.2;
}

.map-session-assignments__summary,
.map-session-assignments__feedback,
.map-session-assignments__player-heading small,
.map-session-assignments__tokens small {
  color: var(--ink-soft);
  font-size: 0.68rem;
  line-height: 1.35;
}

.map-session-assignments__summary,
.map-session-assignments__feedback {
  padding: 0.42rem 0.46rem;
  border: 1px solid var(--rule-soft);
  border-radius: 9px;
  background: var(--paper-inset);
  font-weight: 700;
}

.map-session-assignments__feedback--notice {
  border-color: rgba(70, 180, 122, 0.45);
  background: rgba(70, 180, 122, 0.10);
  color: var(--ink-bright);
}

.map-session-assignments__feedback--error {
  border-color: rgba(255, 31, 45, 0.55);
  background: rgba(255, 31, 45, 0.10);
  color: var(--accent);
}

.map-session-assignments__summary--ready {
  border-color: rgba(70, 180, 122, 0.45);
  background: rgba(70, 180, 122, 0.10);
  color: var(--ink-bright);
}

.map-session-assignments__summary--busy {
  border-color: rgba(143, 184, 255, 0.45);
  background: rgba(143, 184, 255, 0.10);
}

.map-session-assignments__players,
.map-session-assignments__player,
.map-session-assignments__tokens {
  display: grid;
  gap: 0.4rem;
}

.map-session-assignments__player {
  padding: 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 9px;
  background: var(--paper-inset);
}

.map-session-assignments__tokens {
  list-style: none;
  margin: 0;
  padding: 0;
}

.map-session-assignments__tokens li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.35rem;
  align-items: center;
  padding: 0.42rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper);
}

.map-session-assignments__tokens span {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.map-session-assignments__tokens strong {
  color: var(--ink-bright);
  font-size: 0.72rem;
  overflow-wrap: anywhere;
}

.map-session-assignments__tokens small {
  overflow-wrap: anywhere;
}

.map-session-assignments__button {
  min-height: 2rem;
  padding: 0.42rem 0.5rem;
  border: 1px solid rgba(70, 180, 122, 0.45);
  border-radius: 8px;
  background: rgba(70, 180, 122, 0.13);
  color: var(--ink-bright);
  cursor: pointer;
  font: inherit;
  font-size: 0.66rem;
  font-weight: 850;
  white-space: nowrap;
}

.map-session-assignments__button--assigned {
  border-color: rgba(255, 31, 45, 0.5);
  background: rgba(255, 31, 45, 0.12);
}

.map-session-assignments__button:disabled {
  border-color: var(--rule-soft);
  background: var(--paper-soft);
  color: var(--ink-muted);
  cursor: not-allowed;
  opacity: 0.72;
}

.map-session-assignments__button:not(:disabled):hover,
.map-session-assignments__button:not(:disabled):focus-visible {
  border-color: var(--accent);
  background: var(--paper-hover);
  outline: none;
  transform: translateY(-1px);
}

.map-session-assignments__button:not(:disabled):focus-visible {
  outline: 2px solid rgba(255, 31, 45, 0.35);
  outline-offset: 2px;
}

.map-session-navigation__links {
  display: grid;
  gap: 0.45rem;
}

.map-session-navigation__link {
  display: grid;
  gap: 0.22rem;
  min-width: 0;
  padding: 0.52rem 0.55rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink-bright);
  text-decoration: none;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.map-session-navigation__link:hover,
.map-session-navigation__link:focus-visible {
  border-color: var(--accent);
  background: var(--paper-hover);
  color: var(--accent);
  outline: none;
}

.map-session-navigation__link:focus-visible {
  outline: 2px solid rgba(255, 31, 45, 0.35);
  outline-offset: 2px;
}

.map-session-navigation__link span {
  font-size: 0.78rem;
  font-weight: 850;
  letter-spacing: 0.03em;
}

.map-session-navigation__link small {
  overflow-wrap: anywhere;
  font-size: 0.68rem;
}

.map-session-navigation__link--map {
  border-color: rgba(255, 31, 45, 0.45);
  background: var(--paper-accent, var(--paper));
}
</style>
