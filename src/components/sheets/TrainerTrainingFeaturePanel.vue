<script setup lang="ts">
const trainingFeature = defineModel<string | undefined>('trainingFeature')
</script>

<template>
  <div class="block">
    <h2 class="block-title">Training Feature</h2>
    <p>
      <EditableCell v-model="trainingFeature" placeholder="Inspired Training" />
    </p>
  </div>
</template>

<style scoped src="./trainerProgressPanel.css"></style>
