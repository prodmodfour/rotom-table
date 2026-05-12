<script setup lang="ts">
import { toSlug } from '~~/data/ptuReference'
import { referenceDetailPath } from '~/utils/reference/routes'
import type { PtuAbility } from '~/types/ptuReference'

defineProps<{
  abilities: PtuAbility[]
}>()
</script>

<template>
  <main class="ref-list">
    <NuxtLink
      v-for="ability in abilities"
      :key="ability.name"
      :to="referenceDetailPath('ability', toSlug(ability.name))"
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
    <ReferenceEmptyState v-if="abilities.length === 0" message="No abilities match that search." />
  </main>
</template>
