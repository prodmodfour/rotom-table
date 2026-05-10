<script setup lang="ts">
import { PhFolder, PhPlus } from '@phosphor-icons/vue'
import LibraryIntroActionButton from '~/components/library/LibraryIntroActionButton.vue'
import LibraryIntroActionRow from '~/components/library/LibraryIntroActionRow.vue'
import LibraryIntroControls from '~/components/library/LibraryIntroControls.vue'
import LibraryIntroCopy from '~/components/library/LibraryIntroCopy.vue'
import LibraryIntroErrors from '~/components/library/LibraryIntroErrors.vue'
import LibraryIntroPanelCard from '~/components/library/LibraryIntroPanelCard.vue'
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
  <LibraryIntroPanelCard
    title="Tabletop Maps"
    :badge="`${mapCount} map${mapCount === 1 ? '' : 's'}`"
  >
    <LibraryIntroCopy>
      Saved tabletop layouts. Each map stores its own dimensions and the
      set of trainer / Pokémon tokens placed on it. Sheets are managed
      separately under <code>/sheets</code> — maps only reference them, so
      a token's HP, sprite, or class shows up live on every map that
      has it placed.
      <template #hint>
        <template v-if="isGm">
          Click a map to open it. Drag cards or folders to organise them.
          Right-click anything for Move / Rename / Delete. Multiple tabs and
          devices stay in sync as you edit.
        </template>
        <template v-else>
          You are seeing only maps the GM has marked as player visible.
        </template>
      </template>
    </LibraryIntroCopy>

    <LibraryIntroControls>
      <LibraryIntroSearchField
        :model-value="searchTerm"
        label="Search maps"
        placeholder="Search map name…"
        @update:model-value="emit('update:searchTerm', $event)"
      />

      <LibraryIntroActionRow v-if="isGm">
        <LibraryIntroActionButton
          variant="primary"
          :disabled="creating"
          @click="emit('createMap')"
        >
          <PhPlus :size="16" weight="bold" /> New map
        </LibraryIntroActionButton>
        <LibraryIntroActionButton
          :disabled="creating"
          @click="emit('createFolder')"
        >
          <PhFolder :size="16" weight="bold" /> New folder
        </LibraryIntroActionButton>
      </LibraryIntroActionRow>
    </LibraryIntroControls>

    <LibraryIntroErrors
      :errors="[
        { key: 'load', message: loadError },
        { key: 'create', message: createError },
        { key: 'move', message: moveError, prefix: 'Move failed: ' },
      ]"
    />
  </LibraryIntroPanelCard>
</template>
