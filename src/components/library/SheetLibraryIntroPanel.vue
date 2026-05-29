<script setup lang="ts">
import { PhPlus } from '@phosphor-icons/vue'
import LibraryIntroActionButton from '~/components/library/LibraryIntroActionButton.vue'
import LibraryIntroActionRow from '~/components/library/LibraryIntroActionRow.vue'
import LibraryIntroControls from '~/components/library/LibraryIntroControls.vue'
import LibraryIntroErrors from '~/components/library/LibraryIntroErrors.vue'
import LibraryIntroPanelCard from '~/components/library/LibraryIntroPanelCard.vue'
import LibraryIntroSearchField from '~/components/library/LibraryIntroSearchField.vue'
import SheetLibraryNewSheetMenu from '~/components/library/SheetLibraryNewSheetMenu.vue'
import type { SheetLibraryKind } from '~/utils/sheetLibrary'

defineProps<{
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
  <LibraryIntroPanelCard>
    <LibraryIntroControls>
      <LibraryIntroSearchField
        :model-value="searchTerm"
        label="Search sheets"
        placeholder="Search name, species, class, type…"
        @update:model-value="emit('update:searchTerm', $event)"
      />

      <LibraryIntroActionRow v-if="canDrag">
        <SheetLibraryNewSheetMenu
          :open="sheetMenuOpen"
          :disabled="creatingSheet"
          @toggle="emit('toggleSheetMenu')"
          @close="emit('closeSheetMenu')"
          @create-sheet="emit('createSheet', $event)"
        />
        <LibraryIntroActionButton
          :disabled="creating"
          @click="emit('createFolder')"
        >
          <PhPlus :size="16" weight="bold" /> New folder
        </LibraryIntroActionButton>
      </LibraryIntroActionRow>
    </LibraryIntroControls>

    <LibraryIntroErrors
      :errors="[
        { key: 'folder-create', message: createError },
        { key: 'sheet-create', message: sheetCreateError },
        { key: 'move', message: moveError, prefix: 'Move failed: ' },
      ]"
    />
  </LibraryIntroPanelCard>
</template>
