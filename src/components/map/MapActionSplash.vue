<script setup lang="ts">
import { computed } from 'vue'
import InitiativeProfileImage from '~/components/map/InitiativeProfileImage.vue'
import { resolveActionSplashSpeedLinesDurationMs } from '~/utils/actionSplashSettings'
import type { MapActionSplashState } from '~/types/mapActionSplash'

const props = defineProps<{
  splash: MapActionSplashState | null
  speedLinesDurationMs?: number
}>()

const profileEntry = computed(() => props.splash?.profileEntry ?? null)
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
  '--action-splash-speed-lines-duration': `${resolveActionSplashSpeedLinesDurationMs(props.speedLinesDurationMs)}ms`,
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
            <template v-if="profileEntry">
              <InitiativeProfileImage
                class="map-action-splash__portrait-shadow"
                :entry="profileEntry"
              />
              <InitiativeProfileImage
                class="map-action-splash__portrait-image"
                :entry="profileEntry"
              />
            </template>
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
  --action-splash-shadow-offset: clamp(0.35rem, 0.9vw, 0.7rem);
  --action-splash-profile-width: calc(var(--action-splash-inner-height) * 2.6666667);
  --action-splash-edge: color-mix(in srgb, var(--action-splash-accent) 68%, #050608 32%);
  --action-splash-edge-hot: color-mix(in srgb, var(--action-splash-accent) 86%, #111018 14%);
  --action-splash-center: color-mix(in srgb, var(--action-splash-accent) 52%, white 48%);
  --action-splash-line: color-mix(in srgb, var(--action-splash-accent) 24%, white 76%);
  --action-splash-speed-lines-duration: 800ms;

  position: absolute;
  inset: 0;
  z-index: 12050;
  pointer-events: auto;
  overflow: hidden;
  color: white;
  text-shadow: none;
}

.map-action-splash__bar {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  isolation: isolate;
  place-items: center;
  width: 100vw;
  height: var(--action-splash-height);
  box-sizing: border-box;
  overflow: hidden;
  transform: translate(-50%, -50%);
  border-top: var(--action-splash-border-width) solid white;
  border-bottom: var(--action-splash-border-width) solid white;
  background: var(--action-splash-accent);
  background: var(--action-splash-edge);
  box-shadow: 0 24px 56px rgba(0, 0, 0, 0.48);
}

.map-action-splash__bar::before,
.map-action-splash__bar::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.map-action-splash__bar::before {
  inset: -1px -10vw;
  z-index: 0;
  background: linear-gradient(
    90deg,
    var(--action-splash-edge) 0%,
    var(--action-splash-edge-hot) 18%,
    var(--action-splash-accent) 34%,
    var(--action-splash-center) 50%,
    var(--action-splash-accent) 66%,
    var(--action-splash-edge-hot) 82%,
    var(--action-splash-edge) 100%
  );
  background-size: 135% 100%;
  filter: saturate(1.12);
  animation: map-action-splash-gradient-drift 820ms cubic-bezier(0.2, 0, 0.2, 1) infinite alternate;
  will-change: transform, filter;
}

.map-action-splash__bar::after {
  inset: 0 -28%;
  z-index: 1;
  opacity: 0.82;
  background-image:
    linear-gradient(90deg, transparent 0 10%, color-mix(in srgb, var(--action-splash-line) 30%, transparent) 17%, color-mix(in srgb, var(--action-splash-line) 72%, transparent) 24%, transparent 42%),
    linear-gradient(90deg, transparent 0 24%, color-mix(in srgb, var(--action-splash-line) 18%, transparent) 35%, color-mix(in srgb, var(--action-splash-line) 55%, transparent) 45%, transparent 68%),
    linear-gradient(90deg, transparent 0 2%, color-mix(in srgb, var(--action-splash-line) 26%, transparent) 9%, color-mix(in srgb, var(--action-splash-line) 62%, transparent) 15%, transparent 31%),
    linear-gradient(90deg, transparent 0 34%, color-mix(in srgb, var(--action-splash-line) 22%, transparent) 46%, color-mix(in srgb, var(--action-splash-line) 58%, transparent) 56%, transparent 78%),
    linear-gradient(90deg, transparent 0 12%, rgba(255, 255, 255, 0.2) 22%, rgba(255, 255, 255, 0.42) 32%, transparent 54%),
    linear-gradient(90deg, transparent 0 46%, rgba(255, 255, 255, 0.14) 55%, rgba(255, 255, 255, 0.34) 64%, transparent 82%);
  background-position: 0 18%, 9rem 31%, -5rem 43%, 15rem 57%, 3rem 69%, -11rem 82%;
  background-repeat: repeat-x;
  background-size: 30rem 3px, 36rem 2px, 24rem 2px, 42rem 3px, 28rem 2px, 34rem 2px;
  mix-blend-mode: screen;
  animation: map-action-splash-speed-lines var(--action-splash-speed-lines-duration, 800ms) linear infinite;
  will-change: background-position;
}

.map-action-splash__card {
  position: relative;
  z-index: 2;
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
  position: relative;
  display: grid;
  flex: 0 0 var(--action-splash-profile-width);
  place-items: center;
  width: var(--action-splash-profile-width);
  height: var(--action-splash-inner-height);
  overflow: hidden;
}

.map-action-splash__portrait-image,
.map-action-splash__portrait-shadow {
  grid-area: 1 / 1;
  width: 100%;
  height: 100%;
}

.map-action-splash__portrait-shadow {
  z-index: 0;
  filter: brightness(0) saturate(100%);
  transform: translateX(var(--action-splash-shadow-offset));
}

.map-action-splash__portrait-image {
  position: relative;
  z-index: 1;
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
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.42), 0 10px 28px rgba(0, 0, 0, 0.34);
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

@keyframes map-action-splash-gradient-drift {
  from {
    transform: translate3d(-3.5%, 0, 0) scaleX(1.04);
    filter: saturate(1.08) brightness(0.98);
  }
  to {
    transform: translate3d(3.5%, 0, 0) scaleX(1.07);
    filter: saturate(1.24) brightness(1.06);
  }
}

@keyframes map-action-splash-speed-lines {
  from {
    background-position: 0 18%, 9rem 31%, -5rem 43%, 15rem 57%, 3rem 69%, -11rem 82%;
  }
  to {
    background-position: 30rem 18%, 45rem 31%, 19rem 43%, 57rem 57%, 31rem 69%, 23rem 82%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .map-action-splash-enter-active,
  .map-action-splash-leave-active,
  .map-action-splash-enter-active .map-action-splash__bar,
  .map-action-splash-leave-active .map-action-splash__bar {
    animation-duration: 1ms;
  }

  .map-action-splash__bar::before,
  .map-action-splash__bar::after {
    animation: none;
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
