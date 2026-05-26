<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useSessionLobby } from '~/composables/useSessionLobby'
import { buildMapSessionAttachmentActionModel } from '~/utils/mapSessionAttachmentAction'
import { buildMapSessionNavigationModel } from '~/utils/mapSessionNavigation'

const props = withDefaults(defineProps<{
  mapSlug?: string | null
  sessionModeEnabled?: boolean
}>(), {
  mapSlug: null,
  sessionModeEnabled: false,
})

const { isGm } = useAuth()
const {
  identity,
  gmManagement,
  lastAttachedSessionMap,
  busy,
  lastError,
  lastNotice,
  attachMapToSession,
  loadRememberedIdentity,
} = useSessionLobby()

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
  lastError: lastError.value,
  lastNotice: lastNotice.value,
}))

onMounted(() => {
  void loadRememberedIdentity().catch(() => undefined)
})

const attachCurrentMap = async () => {
  if (!attachmentModel.value.canAttach || attachmentModel.value.mapSlug === null) return

  try {
    await attachMapToSession({
      mapSlug: attachmentModel.value.mapSlug,
      selectedMapBehavior: 'select-attached-map',
      visibilityBehavior: 'visible-to-all-players',
    })
  } catch {
    // The lobby composable stores a user-safe error for the panel.
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
