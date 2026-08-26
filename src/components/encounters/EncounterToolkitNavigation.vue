<script setup lang="ts">
const props = defineProps<{ active: 'tables' | 'wild' | 'npc' | 'session' }>()

const items = [
  { id: 'tables' as const, label: 'Tables', to: '/encounter-tables' },
  { id: 'wild' as const, label: 'Wild encounter', to: '/generate' },
  { id: 'npc' as const, label: 'NPC Trainers', to: '/npc-trainers' },
  { id: 'session' as const, label: 'Session prep', to: '/session-prep' },
]
</script>

<template>
  <nav class="toolkit-tabs" aria-label="Campaign Toolkit">
    <NuxtLink
      v-for="item in items"
      :key="item.id"
      :to="item.to"
      :aria-current="props.active === item.id ? 'page' : undefined"
    >
      {{ item.label }}
    </NuxtLink>
  </nav>
</template>

<style scoped>
.toolkit-tabs {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  border-bottom: 1px solid var(--rule);
  scrollbar-width: thin;
}

.toolkit-tabs a {
  position: relative;
  flex: 0 0 auto;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  padding: 0.7rem 1rem;
  color: var(--ink-muted);
  text-decoration: none;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.toolkit-tabs a:hover,
.toolkit-tabs a:focus-visible {
  color: var(--ink);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.toolkit-tabs a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.toolkit-tabs a[aria-current='page'] {
  color: var(--accent);
}

.toolkit-tabs a[aria-current='page']::after {
  content: '';
  position: absolute;
  inset-inline: 0.75rem;
  bottom: -1px;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: var(--accent);
}
</style>
