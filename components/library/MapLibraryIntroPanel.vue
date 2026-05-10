<script setup lang="ts">
import { PhFolder, PhPlus } from '@phosphor-icons/vue'
import LibraryIntroErrors from '~/components/library/LibraryIntroErrors.vue'
import LibraryIntroSearchField from '~/components/library/LibraryIntroSearchField.vue'

defineProps<{
  mapCount: number
  isGm: boolean
  searchTerm: string
  creating: boolean
  loadError: string | null
  createError: string | null
  moveError: string | null
}>()

const emit = defineEmits<{
  'update:searchTerm': [value: string]
  createMap: []
  createFolder: []
}>()
</script>

<template>
  <section class="panel-card maps-intro">
    <div class="intro-heading">
      <h1>Tabletop Maps</h1>
      <span class="badge">{{ mapCount }} map{{ mapCount === 1 ? '' : 's' }}</span>
    </div>
    <p class="intro-copy">
      Saved tabletop layouts. Each map stores its own dimensions and the
      set of trainer / Pokémon tokens placed on it. Sheets are managed
      separately under <code>/sheets</code> — maps only reference them, so
      a token's HP, sprite, or class shows up live on every map that
      has it placed.
      <span v-if="isGm" class="drag-hint">
        Click a map to open it. Drag cards or folders to organise them.
        Right-click anything for Move / Rename / Delete. Multiple tabs and
        devices stay in sync as you edit.
      </span>
      <span v-else class="drag-hint">
        You are seeing only maps the GM has marked as player visible.
      </span>
    </p>

    <div class="intro-controls">
      <LibraryIntroSearchField
        :model-value="searchTerm"
        label="Search maps"
        placeholder="Search map name…"
        @update:model-value="emit('update:searchTerm', $event)"
      />

      <div v-if="isGm" class="folder-actions">
        <button
          type="button"
          class="action-btn"
          :disabled="creating"
          @click="emit('createMap')"
        >
          <PhPlus :size="16" weight="bold" /> New map
        </button>
        <button
          type="button"
          class="action-btn action-btn--secondary"
          :disabled="creating"
          @click="emit('createFolder')"
        >
          <PhFolder :size="16" weight="bold" /> New folder
        </button>
      </div>
    </div>

    <LibraryIntroErrors
      :errors="[
        { key: 'load', message: loadError },
        { key: 'create', message: createError },
        { key: 'move', message: moveError, prefix: 'Move failed: ' },
      ]"
    />
  </section>
</template>

<style scoped>
.panel-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
}

.intro-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.4rem;
}

.intro-heading h1 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.intro-copy {
  margin: 0 0 0.85rem;
  color: var(--ink-soft);
  line-height: 1.5;
}

.drag-hint {
  display: block;
  margin-top: 0.45rem;
  color: var(--ink-muted);
  font-size: 0.85em;
  font-style: italic;
}

code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--accent);
}

.intro-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: stretch;
}

.folder-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  gap: 0.4rem;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--accent);
  border-radius: 10px;
  background: var(--paper-soft);
  color: var(--accent);
  padding: 0.55rem 0.85rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.action-btn--secondary {
  border-color: var(--rule);
  color: var(--ink);
}

.action-btn:hover:not(:disabled) {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.action-btn--secondary:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: progress;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

</style>
