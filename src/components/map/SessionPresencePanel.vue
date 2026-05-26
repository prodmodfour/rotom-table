<script setup lang="ts">
import type { SessionPresencePanelModel, SessionPresenceParticipant } from '~/utils/sessionPresencePanel'

const props = defineProps<{
  model: SessionPresencePanelModel
}>()

const statusLabel = (status: SessionPresenceParticipant['status']): string => {
  if (status === 'connected') return 'Online'
  if (status === 'reconnecting') return 'Reconnecting'
  return 'Offline'
}

const clientLabel = (participant: SessionPresenceParticipant): string => {
  if (participant.connectedClientCount > 0) {
    return `${participant.connectedClientCount} online client${participant.connectedClientCount === 1 ? '' : 's'}`
  }
  if (participant.totalClientCount > 0) {
    return `${participant.totalClientCount} remembered client${participant.totalClientCount === 1 ? '' : 's'}`
  }
  return 'No live client'
}
</script>

<template>
  <aside class="session-presence" aria-label="Track 2 session presence">
    <header class="session-presence__header">
      <div class="session-presence__title-block">
        <p class="session-presence__kicker">Track 2 session</p>
        <h2>Presence</h2>
      </div>
      <div class="session-presence__actor" :title="props.model.sessionId">
        <span class="session-presence__role">{{ props.model.actorRoleLabel }}</span>
        <strong>{{ props.model.actorLabel }}</strong>
      </div>
    </header>

    <dl class="session-presence__summary" aria-label="Session presence summary">
      <div>
        <dt>Players online</dt>
        <dd>{{ props.model.connectedPlayerCount }}</dd>
      </div>
      <div>
        <dt>Clients online</dt>
        <dd>{{ props.model.connectedClientCount }}</dd>
      </div>
      <div>
        <dt>Revision</dt>
        <dd>{{ props.model.currentRevision ?? '—' }}</dd>
      </div>
    </dl>

    <p v-if="props.model.selfParticipant" class="session-presence__self-control">
      Your controls: <strong>{{ props.model.selfParticipant.controls.label }}</strong>
    </p>

    <ul class="session-presence__list" aria-label="Session participants">
      <li
        v-for="participant in props.model.participants"
        :key="participant.id"
        class="session-presence__participant"
        :class="[
          `session-presence__participant--${participant.status}`,
          { 'session-presence__participant--self': participant.isSelf },
        ]"
      >
        <span
          class="session-presence__dot"
          :aria-label="statusLabel(participant.status)"
          :title="statusLabel(participant.status)"
        />
        <div class="session-presence__participant-copy">
          <div class="session-presence__participant-main">
            <strong>{{ participant.displayName }}</strong>
            <span class="session-presence__badge">{{ participant.role === 'gm' ? 'GM' : 'Player' }}</span>
            <span v-if="participant.isSelf" class="session-presence__badge session-presence__badge--self">You</span>
          </div>
          <p>
            <span>{{ clientLabel(participant) }}</span>
            <span aria-hidden="true">•</span>
            <span :title="participant.controls.detail">{{ participant.controls.label }}</span>
          </p>
        </div>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.session-presence {
  position: absolute;
  z-index: 5;
  left: calc(var(--map-overlay-gutter, 0.75rem) + var(--map-nav-rail-width, 0px) + 0.75rem);
  bottom: var(--map-overlay-gutter, 0.75rem);
  display: grid;
  gap: 0.55rem;
  width: min(22rem, calc(100vw - var(--map-nav-rail-width, 0px) - 2.5rem));
  max-height: min(54vh, 24rem);
  overflow: hidden;
  padding: 0.78rem;
  border: 1px solid var(--rule, rgba(255, 255, 255, 0.18));
  border-radius: 1rem;
  background: color-mix(in srgb, rgba(6, 8, 12, 0.82) 86%, var(--paper));
  box-shadow: var(--shadow-card, 0 18px 52px rgba(0, 0, 0, 0.34));
  color: var(--ink-bright);
  pointer-events: auto;
  backdrop-filter: blur(14px) saturate(135%);
  -webkit-backdrop-filter: blur(14px) saturate(135%);
}

.session-presence__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 0.75rem;
}

.session-presence__title-block {
  min-width: 0;
}

.session-presence__kicker {
  margin: 0;
  color: var(--accent);
  font-size: 0.62rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.session-presence h2 {
  margin: 0.1rem 0 0;
  font-family: var(--font-book);
  font-size: 1.04rem;
  line-height: 1;
}

.session-presence__actor {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  min-width: 0;
  max-width: 9rem;
  color: color-mix(in srgb, var(--ink-bright) 86%, transparent);
  font-size: 0.74rem;
  line-height: 1.12;
  text-align: right;
}

.session-presence__actor strong {
  max-width: 100%;
  overflow: hidden;
  color: var(--ink-bright);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-presence__role {
  color: color-mix(in srgb, var(--accent) 82%, white);
  font-size: 0.58rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.session-presence__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
  margin: 0;
}

.session-presence__summary div {
  min-width: 0;
  padding: 0.42rem 0.46rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.72rem;
  background: rgba(255, 255, 255, 0.06);
}

.session-presence__summary dt {
  color: rgba(255, 255, 255, 0.62);
  font-size: 0.58rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.session-presence__summary dd {
  margin: 0.12rem 0 0;
  color: var(--ink-bright);
  font-size: 0.95rem;
  font-weight: 900;
  line-height: 1;
}

.session-presence__self-control {
  margin: 0;
  padding: 0.42rem 0.55rem;
  border: 1px solid color-mix(in srgb, var(--accent) 24%, transparent);
  border-radius: 0.72rem;
  background: color-mix(in srgb, var(--accent) 10%, rgba(255, 255, 255, 0.04));
  color: rgba(255, 255, 255, 0.76);
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1.25;
}

.session-presence__self-control strong {
  color: var(--ink-bright);
}

.session-presence__list {
  display: grid;
  gap: 0.38rem;
  min-height: 0;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  scrollbar-width: thin;
}

.session-presence__participant {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.48rem;
  align-items: start;
  min-width: 0;
  padding: 0.46rem 0.52rem;
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 0.76rem;
  background: rgba(255, 255, 255, 0.055);
}

.session-presence__participant--self {
  border-color: color-mix(in srgb, var(--accent) 36%, rgba(255, 255, 255, 0.16));
}

.session-presence__dot {
  width: 0.62rem;
  height: 0.62rem;
  margin-top: 0.18rem;
  border-radius: 999px;
  background: #6a6f78;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.07);
}

.session-presence__participant--connected .session-presence__dot {
  background: #63e889;
  box-shadow: 0 0 0 3px rgba(99, 232, 137, 0.16), 0 0 12px rgba(99, 232, 137, 0.38);
}

.session-presence__participant--reconnecting .session-presence__dot {
  background: var(--warn);
  box-shadow: 0 0 0 3px rgba(255, 187, 78, 0.16), 0 0 12px rgba(255, 187, 78, 0.32);
}

.session-presence__participant-copy {
  min-width: 0;
}

.session-presence__participant-main {
  display: flex;
  flex-wrap: wrap;
  gap: 0.28rem;
  align-items: center;
  min-width: 0;
}

.session-presence__participant-main strong {
  min-width: 0;
  overflow: hidden;
  font-size: 0.83rem;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-presence__badge {
  flex: 0 0 auto;
  padding: 0.08rem 0.3rem;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.52rem;
  font-weight: 900;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.session-presence__badge--self {
  border-color: color-mix(in srgb, var(--accent) 46%, rgba(255, 255, 255, 0.14));
  color: color-mix(in srgb, var(--accent) 82%, white);
}

.session-presence__participant p {
  display: flex;
  flex-wrap: wrap;
  gap: 0.24rem 0.38rem;
  margin: 0.22rem 0 0;
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.66rem;
  font-weight: 800;
  line-height: 1.2;
}

@media (max-width: 840px) {
  .session-presence {
    left: var(--map-overlay-gutter, 0.75rem);
    width: min(21rem, calc(100vw - 1.5rem));
  }
}

@media (max-width: 620px) {
  .session-presence {
    right: var(--map-overlay-gutter, 0.75rem);
    bottom: calc(var(--map-overlay-gutter, 0.75rem) + 4.25rem);
    width: auto;
    max-height: 42vh;
  }

  .session-presence__summary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
