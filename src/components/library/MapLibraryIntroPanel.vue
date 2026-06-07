<script setup lang="ts">
import { PhFolder, PhPlus } from '@phosphor-icons/vue'
import LibraryIntroActionButton from '~/components/library/LibraryIntroActionButton.vue'
import LibraryIntroActionRow from '~/components/library/LibraryIntroActionRow.vue'
import LibraryIntroControls from '~/components/library/LibraryIntroControls.vue'
import LibraryIntroErrors from '~/components/library/LibraryIntroErrors.vue'
import LibraryIntroPanelCard from '~/components/library/LibraryIntroPanelCard.vue'
import LibraryIntroSearchField from '~/components/library/LibraryIntroSearchField.vue'

defineProps<{
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
  <LibraryIntroPanelCard>
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
