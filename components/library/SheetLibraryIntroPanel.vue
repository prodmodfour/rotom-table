<script setup lang="ts">
import { PhCaretDown, PhPlus } from '@phosphor-icons/vue'
import LibraryIntroActionButton from '~/components/library/LibraryIntroActionButton.vue'
import LibraryIntroActionRow from '~/components/library/LibraryIntroActionRow.vue'
import LibraryIntroErrors from '~/components/library/LibraryIntroErrors.vue'
import LibraryIntroPanelCard from '~/components/library/LibraryIntroPanelCard.vue'
import LibraryIntroSearchField from '~/components/library/LibraryIntroSearchField.vue'
import type { SheetLibraryKind } from '~/utils/sheetLibrary'

defineProps<{
  filteredCount: number
  totalCount: number
  canDrag: boolean
  searchTerm: string
  creating: boolean
  creatingSheet: boolean
  sheetMenuOpen: boolean
  createError: string | null
  sheetCreateError: string | null
  moveError: string | null
}>()

const emit = defineEmits<{
  'update:searchTerm': [value: string]
  toggleSheetMenu: []
  closeSheetMenu: []
  createSheet: [kind: SheetLibraryKind]
  createFolder: []
}>()
</script>

<template>
  <LibraryIntroPanelCard
    title="Character Sheets"
    :badge="`${filteredCount} of ${totalCount}`"
  >
    <p class="intro-copy">
      Trainers and Pokémon character sheets, modelled on the PTU
      <code>pokesheet</code> / <code>trainer</code> spreadsheets. Drop a
      new JSON file into <code>data/sheets/</code> for a Pokémon, or
      <code>data/trainers/</code> for a trainer. Use subdirectories
      (e.g. <code>data/sheets/team-alpha/</code>) to group sheets into
      folders — the directory name is shown exactly as the folder string.
      <span v-if="canDrag" class="drag-hint">
        Tip: click a folder to open it. Drag a card or folder onto
        another folder (or breadcrumb) to move it. Right-click anything
        for Move / Rename / Delete — changes are written straight back
        to disk.
      </span>
      <span v-else class="drag-hint">
        You are seeing only sheets marked as player accessible.
      </span>
    </p>

    <div class="intro-controls">
      <LibraryIntroSearchField
        :model-value="searchTerm"
        label="Search sheets"
        placeholder="Search name, species, class, type…"
        @update:model-value="emit('update:searchTerm', $event)"
      />

      <LibraryIntroActionRow v-if="canDrag">
        <div class="sheet-menu-wrap">
          <LibraryIntroActionButton
            variant="primary"
            :disabled="creatingSheet"
            :aria-expanded="sheetMenuOpen"
            aria-haspopup="menu"
            @click="emit('toggleSheetMenu')"
          >
            <PhPlus :size="16" weight="bold" />
            New sheet
            <PhCaretDown :size="12" weight="bold" aria-hidden="true" />
          </LibraryIntroActionButton>
          <div v-if="sheetMenuOpen" class="sheet-menu" role="menu">
            <button
              type="button"
              class="sheet-menu__item"
              role="menuitem"
              :disabled="creatingSheet"
              @click="emit('createSheet', 'pokemon')"
            >
              Pokémon
            </button>
            <button
              type="button"
              class="sheet-menu__item"
              role="menuitem"
              :disabled="creatingSheet"
              @click="emit('createSheet', 'trainer')"
            >
              Trainer
            </button>
          </div>
        </div>
        <LibraryIntroActionButton
          :disabled="creating"
          @click="emit('createFolder')"
        >
          <PhPlus :size="16" weight="bold" /> New folder
        </LibraryIntroActionButton>
      </LibraryIntroActionRow>
    </div>

    <LibraryIntroErrors
      :errors="[
        { key: 'folder-create', message: createError },
        { key: 'sheet-create', message: sheetCreateError },
        { key: 'move', message: moveError, prefix: 'Move failed: ' },
      ]"
    />
  </LibraryIntroPanelCard>

  <div
    v-if="sheetMenuOpen"
    class="sheet-menu-backdrop"
    @click="emit('closeSheetMenu')"
    @contextmenu.prevent="emit('closeSheetMenu')"
  ></div>
</template>

<style scoped>
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

.sheet-menu-wrap {
  position: relative;
  display: inline-flex;
}

.sheet-menu {
  position: absolute;
  top: calc(100% + 0.3rem);
  left: 0;
  z-index: 50;
  min-width: 160px;
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card), 0 8px 24px rgba(0, 0, 0, 0.35);
  padding: 0.3rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.sheet-menu__item {
  display: flex;
  align-items: center;
  padding: 0.45rem 0.7rem;
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  text-align: left;
  border-radius: 7px;
  cursor: pointer;
}

.sheet-menu__item:hover:not(:disabled),
.sheet-menu__item:focus-visible {
  background: var(--paper-hover);
  color: var(--ink-bright);
  outline: none;
}

.sheet-menu__item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sheet-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: transparent;
}
</style>
