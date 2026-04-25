<script setup lang="ts">
import { computed } from 'vue'
import { describeRef, type RefKind } from '~/data/ptuReference'

const props = defineProps<{
  /** Which reference index to look the entry up in. */
  kind: RefKind
  /** The raw name as written on the source data (pokedex / sheet). */
  name: string
  /** Optional override of the link text (e.g. ``H01 Cut``). Defaults to ``name``. */
  display?: string
}>()

const ref = computed(() => describeRef(props.kind, props.name))

const targetPath = computed(() => {
  const slug = ref.value.slug
  if (!slug) return null
  switch (props.kind) {
    case 'move':       return `/moves/${slug}`
    case 'ability':    return `/abilities/${slug}`
    case 'capability': return `/capabilities/${slug}`
    case 'feature':    return `/features/${slug}`
    case 'edge':       return `/edges/${slug}`
  }
})

const labelText = computed(() => props.display ?? props.name)
</script>

<template>
  <NuxtLink
    v-if="targetPath"
    :to="targetPath"
    class="ref-link"
    :data-kind="kind"
    :title="ref.canonical ?? name"
  >{{ labelText }}</NuxtLink>
  <span v-else class="ref-link ref-link--missing" :title="`No ${kind} entry for \u201c${name}\u201d`">{{ labelText }}</span>
</template>

<style scoped>
.ref-link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: currentColor;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
  text-decoration-style: dotted;
  cursor: pointer;
  transition: color 0.12s ease;
}

.ref-link:hover {
  color: #f0f9ff;
  text-decoration-style: solid;
}

.ref-link--missing {
  cursor: help;
  text-decoration-color: rgba(148, 163, 184, 0.45);
  color: inherit;
}

.ref-link--missing:hover {
  color: inherit;
}
</style>
