<script setup lang="ts">
import { computed } from 'vue'
import type { ConditionTagSize } from '~/utils/conditionTagArt'
import { conditionTagSvg, conditionTitle } from '~/utils/statusConditions'

const props = withDefaults(defineProps<{
  name: string
  size?: ConditionTagSize
}>(), {
  size: 'md',
})

const svg = computed(() => conditionTagSvg(props.name, props.size))
const title = computed(() => conditionTitle(props.name))
</script>

<template>
  <span class="condition-tag" :title="title" v-html="svg" />
</template>

<style scoped>
.condition-tag {
  display: inline-flex;
  align-items: center;
  line-height: 0;
  vertical-align: middle;
}

.condition-tag :deep(svg) {
  display: block;
  flex: 0 0 auto;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.28));
}
</style>
