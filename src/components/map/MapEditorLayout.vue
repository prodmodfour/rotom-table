<script setup lang="ts">
defineProps<{
  sidebarCollapsed: boolean
  initiativeCollapsed: boolean
}>()
</script>

<template>
  <div
    class="layout-shell"
    :class="{
      'layout-shell--sidebar-collapsed': sidebarCollapsed,
      'layout-shell--initiative-collapsed': initiativeCollapsed,
    }"
  >
    <div class="layout-shell__scene">
      <slot name="scene" />
    </div>

    <div class="layout-shell__overlay layout-shell__overlay--left">
      <slot name="left" />
    </div>

    <div class="layout-shell__overlay layout-shell__overlay--right">
      <slot name="right" />
    </div>

    <div class="layout-shell__admin">
      <slot name="admin" />
    </div>
  </div>
</template>

<style scoped>
.layout-shell {
  --map-overlay-gutter: clamp(0.55rem, 1.2vw, 1rem);
  --map-sidebar-width: clamp(310px, 24vw, 380px);
  --initiative-sidebar-width: clamp(300px, 23vw, 360px);

  --map-glass-surface: rgba(5, 6, 8, 0.42);
  --map-glass-surface-strong: rgba(12, 14, 18, 0.58);
  --map-glass-surface-hover: rgba(255, 255, 255, 0.10);
  --map-glass-surface-active: rgba(255, 31, 45, 0.18);
  --map-glass-surface-inset: rgba(5, 6, 8, 0.34);
  --map-glass-border: rgba(255, 255, 255, 0.18);
  --map-glass-border-soft: rgba(255, 255, 255, 0.24);
  --map-glass-border-strong: rgba(255, 255, 255, 0.34);
  --map-glass-accent-border: rgba(255, 31, 45, 0.48);

  --paper: var(--map-glass-surface);
  --paper-soft: var(--map-glass-surface-strong);
  --paper-hover: var(--map-glass-surface-hover);
  --paper-active: var(--map-glass-surface-active);
  --paper-inset: var(--map-glass-surface-inset);
  --paper-accent: color-mix(in srgb, var(--accent) 16%, transparent);
  --rule: var(--map-glass-border);
  --rule-soft: var(--map-glass-border-soft);
  --rule-strong: var(--map-glass-border-strong);
  --rule-active: var(--map-glass-accent-border);
  --shadow-card:
    0 18px 52px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.10);

  position: relative;
  min-height: 100vh;
  overflow: hidden;
  isolation: isolate;
  background: #050608;
}

.layout-shell--sidebar-collapsed {
  --map-sidebar-width: 56px;
}

.layout-shell--initiative-collapsed {
  --initiative-sidebar-width: 56px;
}

.layout-shell__scene {
  position: relative;
  min-width: 0;
  min-height: 100vh;
}

.layout-shell__overlay {
  position: absolute;
  z-index: 2;
  top: var(--map-overlay-gutter);
  bottom: var(--map-overlay-gutter);
  display: flex;
  min-width: 0;
  pointer-events: none;
}

.layout-shell__overlay--left {
  left: var(--map-overlay-gutter);
  width: var(--map-sidebar-width);
}

.layout-shell__overlay--right {
  right: var(--map-overlay-gutter);
  width: var(--initiative-sidebar-width);
}

.layout-shell__admin {
  position: relative;
}

.layout-shell :deep(.panel-card),
.layout-shell :deep(.move-automation),
.layout-shell :deep(.hp-dialog),
.layout-shell :deep(.admin-panel),
.layout-shell :deep(.move-targeting-hud),
.layout-shell :deep(.reaction-prompt) {
  backdrop-filter: blur(14px) saturate(135%);
  -webkit-backdrop-filter: blur(14px) saturate(135%);
}

@media (max-width: 1100px) {
  .layout-shell {
    min-height: 100dvh;
  }

  .layout-shell__overlay {
    height: calc(48dvh - var(--map-overlay-gutter));
  }

  .layout-shell__overlay--left {
    top: var(--map-overlay-gutter);
    bottom: auto;
    width: min(calc(100vw - (var(--map-overlay-gutter) * 2)), var(--map-sidebar-width));
  }

  .layout-shell__overlay--right {
    top: auto;
    bottom: var(--map-overlay-gutter);
    width: min(calc(100vw - (var(--map-overlay-gutter) * 2)), var(--initiative-sidebar-width));
  }
}
</style>
