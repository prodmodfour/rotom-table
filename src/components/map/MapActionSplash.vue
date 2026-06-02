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
      <div class="map-action-splash__bar" aria-hidden="true">
        <span class="map-action-splash__slash map-action-splash__slash--left" />
        <span class="map-action-splash__slash map-action-splash__slash--right" />
        <span class="map-action-splash__glow" />
      </div>

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
  </Transition>
</template>

<style scoped>
.map-action-splash {
  position: absolute;
  inset: 0;
  z-index: 12050;
  display: grid;
  place-items: center;
  pointer-events: none;
  overflow: hidden;
  color: white;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.72), 0 0 18px rgba(0, 0, 0, 0.58);
}

.map-action-splash::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.12), transparent 32%),
    linear-gradient(180deg, rgba(0, 0, 0, 0.10), rgba(0, 0, 0, 0.42));
}

.map-action-splash__bar {
  position: absolute;
  left: 50%;
  width: min(100vw, 980px);
  height: clamp(9.4rem, 24vh, 14.5rem);
  transform: translateX(-50%) skewX(-13deg);
  overflow: hidden;
  border-top: 3px solid rgba(255, 255, 255, 0.86);
  border-bottom: 3px solid rgba(255, 255, 255, 0.86);
  background:
    linear-gradient(90deg,
      rgba(3, 5, 9, 0.96) 0%,
      rgba(3, 5, 9, 0.90) 16%,
      color-mix(in srgb, var(--action-splash-accent) 76%, #111827) 42%,
      var(--action-splash-accent) 64%,
      color-mix(in srgb, var(--action-splash-accent) 58%, #050608) 100%),
    var(--action-splash-accent);
  box-shadow:
    0 28px 68px rgba(0, 0, 0, 0.50),
    inset 0 0 0 1px rgba(255, 255, 255, 0.22),
    inset 0 -34px 60px rgba(0, 0, 0, 0.34);
}

.map-action-splash__bar::before,
.map-action-splash__bar::after {
  content: '';
  position: absolute;
  inset: -30% auto -30% 50%;
  width: 8rem;
  transform: translateX(-50%) skewX(-18deg);
  background: rgba(255, 255, 255, 0.20);
  mix-blend-mode: screen;
}

.map-action-splash__bar::after {
  left: 67%;
  width: 12rem;
  background: rgba(255, 255, 255, 0.10);
}

.map-action-splash__slash {
  position: absolute;
  top: -18%;
  bottom: -18%;
  width: clamp(6rem, 18vw, 13rem);
  background: rgba(0, 0, 0, 0.52);
  box-shadow: 0 0 34px rgba(0, 0, 0, 0.28);
}

.map-action-splash__slash--left {
  left: -4rem;
  transform: skewX(-18deg);
}

.map-action-splash__slash--right {
  right: -5rem;
  transform: skewX(-18deg);
}

.map-action-splash__glow {
  position: absolute;
  inset: 10% 15%;
  border-radius: 999px;
  background: radial-gradient(circle, color-mix(in srgb, var(--action-splash-accent) 50%, white) 0%, transparent 58%);
  filter: blur(26px);
  opacity: 0.65;
}

.map-action-splash__card {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: 0.54rem;
  margin: 0;
  transform: translateY(-0.08rem);
}

.map-action-splash__portrait {
  display: grid;
  place-items: center;
  width: clamp(7.2rem, 15vw, 10.6rem);
  aspect-ratio: 1;
  overflow: hidden;
  border: 4px solid rgba(255, 255, 255, 0.94);
  border-radius: 1.35rem;
  background:
    radial-gradient(circle at 50% 38%, rgba(255, 255, 255, 0.30), rgba(255, 255, 255, 0.04) 42%, rgba(0, 0, 0, 0.38) 100%),
    color-mix(in srgb, var(--action-splash-accent) 26%, #111827);
  box-shadow:
    0 20px 44px rgba(0, 0, 0, 0.48),
    0 0 0 8px rgba(0, 0, 0, 0.34),
    0 0 40px color-mix(in srgb, var(--action-splash-accent) 52%, transparent);
}

.map-action-splash__portrait img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.map-action-splash__initials {
  font-size: clamp(2.2rem, 7vw, 4.5rem);
  font-weight: 1000;
  letter-spacing: -0.08em;
}

.map-action-splash__caption {
  display: grid;
  gap: 0.16rem;
  min-width: min(26rem, calc(100vw - 2rem));
  padding: 0.44rem 1rem 0.58rem;
  border: 2px solid rgba(255, 255, 255, 0.88);
  border-radius: 0.95rem;
  background: rgba(0, 0, 0, 0.70);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--action-splash-accent) 54%, transparent),
    0 12px 30px rgba(0, 0, 0, 0.36);
  text-align: center;
}

.map-action-splash__actor {
  color: rgba(255, 255, 255, 0.74);
  font-size: clamp(0.72rem, 1.5vw, 0.9rem);
  font-weight: 900;
  letter-spacing: 0.12em;
  line-height: 1;
  text-transform: uppercase;
}

.map-action-splash__action {
  font-size: clamp(1.14rem, 3vw, 1.82rem);
  font-weight: 1000;
  letter-spacing: 0.01em;
  line-height: 1.05;
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
    transform: scale(1.04);
  }
  to {
    opacity: 1;
    transform: scale(1);
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
  .map-action-splash__bar {
    width: calc(100vw + 4rem);
    height: clamp(8.4rem, 24vh, 12rem);
  }

  .map-action-splash__caption {
    min-width: min(22rem, calc(100vw - 1.5rem));
  }
}
</style>
