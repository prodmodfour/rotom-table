<script setup lang="ts">
import { computed } from 'vue'
import { capabilityArtSvg, capabilityArtTitle, type CapabilityArtSize } from '~/utils/capabilityArt'

const props = withDefaults(defineProps<{
  name: string
  size?: CapabilityArtSize
}>(), {
  size: 'md',
})

const svg = computed(() => capabilityArtSvg(props.name, props.size))
const title = computed(() => capabilityArtTitle(props.name))
</script>

<template>
  <span class="capability-art" :title="title" v-html="svg" />
</template>

<style scoped>
.capability-art {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
  vertical-align: middle;
}

.capability-art :deep(svg) {
  display: block;
  flex: 0 0 auto;
  border-radius: 22px;
  filter:
    drop-shadow(0 14px 22px rgba(0, 0, 0, 0.38))
    drop-shadow(0 1px 0 rgba(255, 255, 255, 0.08));
}
</style>
