<template>
  <div class="bulk-row">
    <slot />
  </div>
</template>

<style scoped>
.bulk-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}
</style>
