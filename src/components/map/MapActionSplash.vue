<script setup lang="ts">
import { computed } from 'vue'
import type { MapActionSplashState } from '~/types/mapActionSplash'

const props = defineProps<{
  splash: MapActionSplashState | null
}>()

const imageUrl = computed(() => props.splash?.profileUrl ?? props.splash?.fallbackSpriteUrl ?? null)
const initials = computed(() => {
  const name = props.splash?.actorName.trim() ?? ''
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?'
})

const splashStyle = computed(() => ({
  '--action-splash-accent': props.splash?.accentColor?.trim() || 'var(--accent)',
}))
</script>

<template>
  <Transition name="map-action-splash" mode="out-in">
    <div
      v-if="splash"
      :key="splash.id"
      class="map-action-splash"
      :style="splashStyle"
      role="status"
      aria-live="polite"
      :aria-label="`${splash.actorName} ${splash.actionLabel}`"
    >
      <div class="map-action-splash__bar">
        <figure class="map-action-splash__card">
          <span class="map-action-splash__portrait">
            <img
              v-if="imageUrl"
              :src="imageUrl"
              :alt="splash.actorName"
              draggable="false"
            />
            <span v-else class="map-action-splash__initials">{{ initials }}</span>
          </span>
          <figcaption class="map-action-splash__caption">
            <span class="map-action-splash__actor">{{ splash.actorName }}</span>
            <span class="map-action-splash__action">{{ splash.actionLabel }}</span>
          </figcaption>
        </figure>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.map-action-splash {
  --action-splash-height: clamp(8rem, 22vh, 13rem);
  --action-splash-border-width: 4px;
  --action-splash-inner-height: calc(var(--action-splash-height) - (var(--action-splash-border-width) * 2));

  position: absolute;
  inset: 0;
  z-index: 12050;
  pointer-events: auto;
  overflow: hidden;
  color: white;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.72), 0 0 18px rgba(0, 0, 0, 0.58);
}

.map-action-splash__bar {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  place-items: center;
  width: 100vw;
  height: var(--action-splash-height);
  box-sizing: border-box;
  overflow: hidden;
  transform: translate(-50%, -50%);
  border-top: var(--action-splash-border-width) solid white;
  border-bottom: var(--action-splash-border-width) solid white;
  background: var(--action-splash-accent);
  box-shadow: 0 24px 56px rgba(0, 0, 0, 0.48);
}

.map-action-splash__card {
  display: flex;
  align-items: stretch;
  width: min(100%, 72rem);
  height: var(--action-splash-inner-height);
  margin: 0;
  padding-inline: clamp(1rem, 5vw, 4rem);
  box-sizing: border-box;
  gap: clamp(1rem, 3.5vw, 2.4rem);
}

.map-action-splash__portrait {
  display: grid;
  flex: 0 0 var(--action-splash-inner-height);
  place-items: center;
  width: var(--action-splash-inner-height);
  height: var(--action-splash-inner-height);
  overflow: hidden;
}

.map-action-splash__portrait img {
  display: block;
  width: auto;
  min-width: 100%;
  height: 100%;
  max-width: none;
  object-fit: cover;
  image-rendering: pixelated;
}

.map-action-splash__initials {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-size: clamp(2.6rem, 8vw, 5.8rem);
  font-weight: 1000;
  letter-spacing: -0.08em;
}

.map-action-splash__caption {
  display: grid;
  align-content: center;
  min-width: 0;
  gap: 0.24rem;
}

.map-action-splash__actor {
  color: rgba(255, 255, 255, 0.76);
  font-size: clamp(0.72rem, 1.6vw, 0.95rem);
  font-weight: 900;
  letter-spacing: 0.12em;
  line-height: 1;
  text-transform: uppercase;
}

.map-action-splash__action {
  font-size: clamp(1.55rem, 4.4vw, 3.3rem);
  font-weight: 1000;
  letter-spacing: 0.01em;
  line-height: 1.02;
}

.map-action-splash-enter-active {
  animation: map-action-splash-pop 220ms cubic-bezier(0.18, 0.92, 0.24, 1);
}

.map-action-splash-leave-active {
  animation: map-action-splash-pop 180ms ease-in reverse;
}

.map-action-splash-enter-active .map-action-splash__bar,
.map-action-splash-leave-active .map-action-splash__bar {
  animation: map-action-splash-bar 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.map-action-splash-leave-active .map-action-splash__bar {
  animation-direction: reverse;
}

@keyframes map-action-splash-pop {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes map-action-splash-bar {
  from {
    clip-path: inset(0 50% 0 50%);
  }
  to {
    clip-path: inset(0 0 0 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .map-action-splash-enter-active,
  .map-action-splash-leave-active,
  .map-action-splash-enter-active .map-action-splash__bar,
  .map-action-splash-leave-active .map-action-splash__bar {
    animation-duration: 1ms;
  }
}

@media (max-width: 720px) {
  .map-action-splash {
    --action-splash-height: clamp(7rem, 21vh, 10rem);
  }

  .map-action-splash__card {
    padding-inline: 0.75rem;
    gap: 0.85rem;
  }
}
</style>
