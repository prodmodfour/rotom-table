<script setup lang="ts">
import type { CapabilityToken } from '~/utils/pokedex/entryDetails'

defineProps<{
  capabilityTokens: CapabilityToken[]
  skillPhrase: string
}>()
</script>

<template>
  <section v-if="capabilityTokens.length" class="book-section">
    <h3 class="book-section__title">Capability List</h3>
    <p class="paragraph">
      <template v-for="(token, i) in capabilityTokens" :key="`cap-${i}`"
        ><span v-if="i > 0">, </span
        ><PokedexRefLink
          v-if="token.ref"
          kind="capability"
          :name="token.ref"
          :display="token.display"
        /><span v-else>{{ token.display }}</span
      ></template>
    </p>
  </section>

  <section v-if="skillPhrase" class="book-section">
    <h3 class="book-section__title">Skill List</h3>
    <p class="paragraph">{{ skillPhrase }}</p>
  </section>
</template>
