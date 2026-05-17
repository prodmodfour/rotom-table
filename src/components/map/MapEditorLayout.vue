<template>
  <div class="layout-shell">
    <div class="layout-shell__scene">
      <slot name="scene" />
    </div>

    <div class="layout-shell__nav">
      <slot name="nav" />
    </div>

    <div class="layout-shell__modals">
      <slot name="modals" />
    </div>
  </div>
</template>

<style scoped>
.layout-shell {
  --map-overlay-gutter: clamp(0.55rem, 1.2vw, 1rem);
  --map-nav-rail-width: clamp(112px, 9vw, 156px);
  --map-initiative-profile-width: clamp(88px, 8.5vw, 124px);
  --map-initiative-profile-height: clamp(33px, 3.2vw, 46px);
  --map-initiative-info-bar-height: calc(var(--map-initiative-profile-height) + 1rem);
  --map-combat-log-top: calc(
    var(--map-overlay-gutter) + var(--map-initiative-info-bar-height) + 0.6rem
  );

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

.layout-shell__scene {
  position: relative;
  min-width: 0;
  min-height: 100vh;
}

.layout-shell__nav {
  position: absolute;
  z-index: 6;
  top: var(--map-overlay-gutter);
  bottom: var(--map-overlay-gutter);
  left: var(--map-overlay-gutter);
  width: var(--map-nav-rail-width);
  min-width: 0;
  pointer-events: none;
}

.layout-shell__modals {
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
    --map-nav-rail-width: clamp(96px, 18vw, 140px);
    min-height: 100dvh;
  }
}
</style>
