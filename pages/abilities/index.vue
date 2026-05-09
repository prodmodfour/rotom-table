<script setup lang="ts">
import { computed, ref } from 'vue'
import { abilities, toSlug } from '~/data/ptuReference'
import { filterAbilitiesForIndex } from '~/utils/reference/abilityIndex'

useHead({ title: 'Abilities · Rotom Table' })

const searchTerm = ref('')

const filtered = computed(() => filterAbilitiesForIndex(abilities, { searchTerm: searchTerm.value }))
</script>

<template>
  <div class="ref-index">
    <ReferenceIndexHeader title="Abilities" :count="filtered.length" :total="abilities.length">
      <p class="ref-copy">
        PTU 1.05 ability list from
        <code>ptu-data/data/abilities.json</code>.
      </p>
      <ReferenceSearchField
        v-model="searchTerm"
        label="Search abilities"
        placeholder="Search by name, frequency, trigger, or effect…"
      />
    </ReferenceIndexHeader>

    <main class="ref-list">
      <NuxtLink
        v-for="ability in filtered"
        :key="ability.name"
        :to="`/abilities/${toSlug(ability.name)}`"
        class="ref-row"
      >
        <div class="ref-row__heading">
          <h2>{{ ability.name }}</h2>
          <span v-if="ability.frequency" class="ref-row__freq">{{ ability.frequency }}</span>
        </div>
        <p v-if="ability.trigger" class="ref-row__trigger">
          <span class="label">Trigger:</span> {{ ability.trigger }}
        </p>
        <p v-if="ability.effect" class="ref-row__effect">
          {{ ability.effect }}
        </p>
      </NuxtLink>
      <p v-if="filtered.length === 0" class="empty-state">No abilities match that search.</p>
    </main>
  </div>
</template>


