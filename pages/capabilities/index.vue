<script setup lang="ts">
import { computed, ref } from 'vue'
import { capabilities } from '~/data/ptuReference'
import { filterCapabilities } from '~/utils/reference/capabilityIndex'
import { referenceIndexTitle } from '~/utils/reference/pageTitles'

useHead({ title: referenceIndexTitle('Capabilities') })

const searchTerm = ref('')
const filtered = computed(() => filterCapabilities(capabilities, searchTerm.value))
</script>

<template>
  <div class="ref-index">
    <ReferenceIndexHeader title="Capabilities" :count="filtered.length" :total="capabilities.length">
      <p class="ref-copy">
        Named PTU capabilities from <code>ptu-data/data/capabilities.json</code>.
        The numeric movement keywords (Overland, Sky, Swim, Levitate, Burrow,
        Jump, Power) are core mechanics and live in the rulebook itself.
      </p>
      <ReferenceSearchField
        v-model="searchTerm"
        label="Search capabilities"
        placeholder="Search by name or effect…"
      />
    </ReferenceIndexHeader>

    <CapabilityIndexList :capabilities="filtered" />
  </div>
</template>
