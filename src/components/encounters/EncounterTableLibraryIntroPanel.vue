<script setup lang="ts">
import { PhFolder, PhPlus } from '@phosphor-icons/vue'
import { ENCOUNTER_GENERATOR_PATH } from '~/utils/encounterRoutes'
import LibraryIntroActionButton from '~/components/library/LibraryIntroActionButton.vue'
import LibraryIntroActionRow from '~/components/library/LibraryIntroActionRow.vue'
import LibraryIntroControls from '~/components/library/LibraryIntroControls.vue'
import LibraryIntroCopy from '~/components/library/LibraryIntroCopy.vue'
import LibraryIntroErrors from '~/components/library/LibraryIntroErrors.vue'
import LibraryIntroPanelCard from '~/components/library/LibraryIntroPanelCard.vue'
import LibraryIntroSearchField from '~/components/library/LibraryIntroSearchField.vue'

defineProps<{
  filteredCount: number
  totalCount: number
  canManage: boolean
  searchTerm: string
  creating: boolean
  loadError: string | null
  createError: string | null
  moveError: string | null
}>()

const emit = defineEmits<{
  'update:searchTerm': [value: string]
  createTable: []
  createFolder: []
}>()
</script>

<template>
  <LibraryIntroPanelCard
    title="Encounter Tables"
    :badge="`${filteredCount} of ${totalCount}`"
  >
    <LibraryIntroCopy>
      Browse encounter-table JSON files under <code>encounter_tables/</code>.
      Folders can represent regions, routes, or adventure arcs; each table can
      be rolled from the <NuxtLink :to="ENCOUNTER_GENERATOR_PATH" class="inline-link">Generate</NuxtLink>
      page to produce wild Pokémon sheets.
      <template #hint>
        <template v-if="canManage">
          Click a folder to open it. Drag tables or folders to organise them.
          Right-click anything for Move / Rename / Delete. New tables start as
          a safe one-entry template written straight to disk.
        </template>
        <template v-else>
          Encounter-table file management is available to GMs while running the
          local development server.
        </template>
      </template>
    </LibraryIntroCopy>

    <LibraryIntroControls>
      <LibraryIntroSearchField
        :model-value="searchTerm"
        label="Search encounter tables"
        placeholder="Search folder, table, or species…"
        @update:model-value="emit('update:searchTerm', $event)"
      />

      <LibraryIntroActionRow v-if="canManage">
        <LibraryIntroActionButton
          variant="primary"
          :disabled="creating"
          @click="emit('createTable')"
        >
          <PhPlus :size="16" weight="bold" /> New table
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

<style scoped>
.inline-link {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
  text-underline-offset: 0.18em;
}

.inline-link:hover {
  text-decoration-color: var(--accent);
}
</style>
