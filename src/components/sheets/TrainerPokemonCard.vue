<script setup lang="ts">
import { computed } from 'vue'
import { sheetEditorPath } from '~/utils/sheetRoutes'
import type { ResolvedTrainerPokemonLink, TrainerPokemonRosterKind } from '~/utils/trainerPokemonLinks'

const props = withDefaults(defineProps<{
  member: ResolvedTrainerPokemonLink
  variant?: TrainerPokemonRosterKind
  canMoveToTeam?: boolean
}>(), {
  variant: 'box',
  canMoveToTeam: true,
})

const emit = defineEmits<{
  moveToTeam: [slug: string]
  moveToBox: [slug: string]
  unlink: [slug: string]
  dragStart: [event: DragEvent, slug: string, sourceRoster: TrainerPokemonRosterKind]
  dragEnd: []
  dragOver: [event: DragEvent, targetSlug: string]
  drop: [event: DragEvent, targetSlug: string]
}>()

const pokemonPath = computed(() => (
  props.member.sheet ? sheetEditorPath('pokemon', props.member.slug) : ''
))

const levelLabel = computed(() => (
  typeof props.member.level === 'number' ? `Lv ${props.member.level}` : 'Missing sheet'
))

const metaLabel = computed(() => (
  props.member.species ? `${props.member.species} · ${levelLabel.value}` : levelLabel.value
))

const startDrag = (event: DragEvent) => {
  emit('dragStart', event, props.member.slug, props.variant)
}
</script>

<template>
  <article
    class="pokemon-link-card"
    :class="`pokemon-link-card--${props.variant}`"
    @dragover="emit('dragOver', $event, member.slug)"
    @drop="emit('drop', $event, member.slug)"
  >
    <button
      type="button"
      class="pokemon-link-card__drag-handle"
      draggable="true"
      :aria-label="`Drag ${member.displayName} between team and box`"
      :title="`Drag ${member.displayName} between team and box`"
      @click.prevent
      @dragstart="startDrag"
      @dragend="emit('dragEnd')"
    >
      <span aria-hidden="true">⋮⋮</span>
    </button>

    <NuxtLink
      v-if="member.sheet"
      class="pokemon-link-card__sprite-link"
      :to="pokemonPath"
      :aria-label="`Open ${member.displayName}'s sheet`"
    >
      <img v-if="member.spriteUrl" :src="member.spriteUrl" :alt="member.displayName" />
      <span v-else aria-hidden="true">?</span>
    </NuxtLink>
    <span v-else class="pokemon-link-card__sprite-link pokemon-link-card__sprite-link--missing">
      <span aria-hidden="true">?</span>
    </span>

    <span class="pokemon-link-card__body">
      <NuxtLink v-if="member.sheet" class="pokemon-link-card__name" :to="pokemonPath">
        {{ member.displayName }}
      </NuxtLink>
      <span v-else class="pokemon-link-card__name pokemon-link-card__name--missing">
        {{ member.displayName }}
      </span>
      <span class="pokemon-link-card__meta">{{ metaLabel }}</span>
    </span>

    <span class="pokemon-link-card__actions" aria-label="Pokémon roster actions">
      <button
        v-if="props.variant === 'box'"
        type="button"
        class="pokemon-link-card__action"
        :disabled="!props.canMoveToTeam"
        :title="props.canMoveToTeam ? 'Move to team' : 'Team is full'"
        @click="emit('moveToTeam', member.slug)"
      >Team</button>
      <button
        v-else
        type="button"
        class="pokemon-link-card__action"
        @click="emit('moveToBox', member.slug)"
      >Box</button>
      <button
        type="button"
        class="pokemon-link-card__action pokemon-link-card__action--danger"
        @click="emit('unlink', member.slug)"
      >Unlink</button>
    </span>
  </article>
</template>

<style scoped>
.pokemon-link-card {
  display: grid;
  grid-template-columns: 18px 56px minmax(0, 1fr);
  grid-template-areas:
    "drag sprite body"
    "drag sprite actions";
  gap: 0.45rem 0.6rem;
  align-items: center;
  min-width: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper);
  padding: 0.55rem;
}

.pokemon-link-card--team {
  grid-template-columns: 18px 50px minmax(0, 1fr);
  padding: 0.5rem;
  background: linear-gradient(135deg, rgba(255, 31, 45, 0.1), var(--paper));
}

.pokemon-link-card__drag-handle {
  grid-area: drag;
  align-self: stretch;
  display: grid;
  place-items: center;
  min-width: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--ink-faint);
  padding: 0;
  cursor: grab;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 900;
  letter-spacing: -0.2em;
  line-height: 1;
  touch-action: none;
  user-select: none;
}

.pokemon-link-card__drag-handle:hover,
.pokemon-link-card__drag-handle:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}

.pokemon-link-card__drag-handle:active {
  cursor: grabbing;
}

.pokemon-link-card__sprite-link {
  grid-area: sprite;
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: radial-gradient(circle at center, var(--paper-hover), var(--paper-inset));
  color: var(--ink-faint);
  overflow: hidden;
  text-decoration: none;
}

.pokemon-link-card--team .pokemon-link-card__sprite-link {
  width: 50px;
  height: 50px;
}

.pokemon-link-card__sprite-link img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
  padding: 3px;
}

.pokemon-link-card__sprite-link--missing {
  border-style: dashed;
}

.pokemon-link-card__body {
  grid-area: body;
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.12rem;
}

.pokemon-link-card__name {
  color: var(--ink-bright);
  font-weight: 700;
  letter-spacing: 0.02em;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pokemon-link-card__name:hover {
  color: var(--accent);
}

.pokemon-link-card__name--missing {
  color: var(--warn);
}

.pokemon-link-card__meta {
  color: var(--ink-muted);
  font-size: 0.76rem;
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pokemon-link-card__actions {
  grid-area: actions;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.pokemon-link-card__action {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--ink-soft);
  padding: 0.18rem 0.5rem;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
}

.pokemon-link-card__action:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.pokemon-link-card__action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.pokemon-link-card__action--danger:hover:not(:disabled) {
  border-color: rgba(255, 31, 45, 0.62);
  color: var(--bad);
  background: rgba(255, 31, 45, 0.08);
}
</style>
