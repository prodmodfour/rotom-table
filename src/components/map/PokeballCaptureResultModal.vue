<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ItemSprite from '~/components/ItemSprite.vue'
import {
  playPokeballFailSound,
  playPokeballShakeSound,
  playPokeballSuccessSound,
  playPokeballThrowSound,
} from '~/utils/pokeballSoundEffects'
import type { PokeballCaptureAttemptResult } from '~/utils/pokeballCapture'
import { trainerAccentCssVariables } from '~/utils/trainerAccent'

const props = defineProps<{
  result: PokeballCaptureAttemptResult
  accentColor?: string | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

const BALL_POP_ANIMATION_MS = 350

const modalAccentStyle = computed(() => trainerAccentCssVariables(props.accentColor))
const outcomeLabel = computed(() => (props.result.success ? 'Caught!' : 'Escaped...'))

const currentShake = ref(0)
const done = ref(false)
const resultVisible = ref(false)
const timers: Array<ReturnType<typeof setTimeout>> = []

const clearTimers = () => {
  while (timers.length) {
    const timer = timers.pop()
    if (timer) clearTimeout(timer)
  }
}

const schedule = (callback: () => void, delay: number) => {
  const timer = setTimeout(callback, delay)
  timers.push(timer)
}

const startAnimation = () => {
  clearTimers()
  currentShake.value = 0
  done.value = false
  resultVisible.value = false
  void playPokeballThrowSound()

  if (!props.result.hit || props.result.shakeCount <= 0) {
    schedule(() => {
      done.value = true
      void playPokeballFailSound()
      schedule(() => {
        resultVisible.value = true
      }, BALL_POP_ANIMATION_MS)
    }, 620)
    return
  }

  for (let shake = 1; shake <= props.result.shakeCount; shake += 1) {
    schedule(() => {
      currentShake.value = shake
      void playPokeballShakeSound()
    }, 520 + ((shake - 1) * 720))
  }

  schedule(() => {
    done.value = true
    void (props.result.success ? playPokeballSuccessSound() : playPokeballFailSound())
    schedule(() => {
      resultVisible.value = true
    }, BALL_POP_ANIMATION_MS)
  }, 520 + (props.result.shakeCount * 720))
}

watch(() => props.result.id, () => startAnimation())

onMounted(startAnimation)
onBeforeUnmount(clearTimers)
</script>

<template>
  <Teleport to="body">
    <div class="capture-modal-backdrop" @click.self="emit('close')">
      <section class="capture-modal" :style="modalAccentStyle" role="dialog" aria-modal="true" aria-label="Poké Ball capture result">
        <div class="capture-modal__stage" :class="{ 'is-done': done, 'is-success': result.success && done, 'is-failure': !result.success && done }">
          <div class="capture-modal__portrait">
            <img v-if="result.targetSpriteUrl" :src="result.targetSpriteUrl" :alt="result.targetName" loading="lazy">
            <span v-else>{{ result.targetSpecies }}</span>
            <span
              v-if="resultVisible"
              class="capture-modal__outcome-label"
              :class="result.success ? 'is-success' : 'is-failure'"
              aria-live="polite"
            >{{ outcomeLabel }}</span>
          </div>

          <div class="capture-modal__ball-wrap" :key="currentShake">
            <div class="capture-modal__ball" :class="{ 'is-shaking': currentShake > 0 && !done }">
              <ItemSprite :item="result.pokeballName" :alt="result.pokeballName" size="xl" />
              <span class="capture-modal__fallback-ball" aria-hidden="true" />
            </div>
          </div>
        </div>

        <div class="capture-modal__roll-summary">
          <span>Capture Rate <strong class="capture-modal__rate-number">{{ result.captureRate }}</strong></span>
          <span
            class="capture-modal__roll-row"
            :class="{ 'is-visible': resultVisible }"
            :aria-hidden="resultVisible ? undefined : 'true'"
          >Capture Roll <strong class="capture-modal__roll-number" :class="result.success ? 'is-success' : 'is-failure'">{{ result.adjustedCaptureRoll ?? '—' }}</strong></span>
        </div>

        <div class="capture-modal__actions">
          <button class="capture-modal__dismiss" type="button" @click="emit('close')">Close</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.capture-modal-backdrop {
  position: fixed;
  z-index: 14000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1.25rem;
  background: transparent;
}

.capture-modal {
  width: min(16rem, 100%);
  max-height: min(92vh, 920px);
  position: relative;
  overflow: auto;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 18px;
  background: rgba(5, 6, 8, 0.42);
  box-shadow:
    0 24px 70px rgba(0, 0, 0, 0.30),
    inset 0 1px 0 rgba(255, 255, 255, 0.10);
  color: var(--ink);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  backdrop-filter: blur(18px) saturate(140%);
}

.capture-modal__stage {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
  align-items: center;
  justify-items: center;
  padding: 2rem 1.25rem 1.25rem;
}

.capture-modal__portrait {
  position: relative;
  display: inline-grid;
  width: fit-content;
  height: fit-content;
  place-items: center;
  justify-self: center;
}

.capture-modal__portrait img {
  display: block;
  max-width: min(100%, 18rem);
  max-height: 13rem;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.5));
}

.capture-modal__outcome-label {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 2;
  padding: 0.18rem 0.55rem 0.24rem;
  border-radius: 999px;
  background: rgba(5, 6, 8, 0.62);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  font-size: clamp(1.2rem, 8vw, 2.25rem);
  font-weight: 950;
  letter-spacing: 0.04em;
  line-height: 1;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.82);
  transform: translate(-50%, -50%) rotate(-4deg);
  white-space: nowrap;
}

.capture-modal__outcome-label.is-success {
  color: var(--good);
  text-shadow:
    0 2px 0 rgba(0, 0, 0, 0.82),
    0 0 14px color-mix(in srgb, var(--good) 72%, transparent);
}

.capture-modal__outcome-label.is-failure {
  color: var(--bad);
  text-shadow:
    0 2px 0 rgba(0, 0, 0, 0.82),
    0 0 14px color-mix(in srgb, var(--bad) 72%, transparent);
}

.capture-modal__ball-wrap {
  display: grid;
  justify-items: center;
  gap: 0.55rem;
}

.capture-modal__ball {
  position: relative;
  display: grid;
  width: 5.8rem;
  height: 5.8rem;
  place-items: center;
}

.capture-modal__ball :deep(.item-sprite) {
  position: relative;
  z-index: 1;
}

.capture-modal__fallback-ball {
  position: absolute;
  width: 4.2rem;
  height: 4.2rem;
  border: 3px solid #1d1d1d;
  border-radius: 999px;
  background:
    radial-gradient(circle at center, white 0 14%, #1d1d1d 15% 20%, transparent 21%),
    linear-gradient(#d92630 0 46%, #1d1d1d 47% 53%, #f8f8f8 54% 100%);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.42);
}

.capture-modal__ball:has(.item-sprite) .capture-modal__fallback-ball {
  display: none;
}

.capture-modal__ball.is-shaking {
  animation: capture-ball-shake 0.42s ease-in-out;
}

.capture-modal__stage.is-success .capture-modal__ball,
.capture-modal__stage.is-failure .capture-modal__ball {
  animation: capture-ball-pop 0.35s ease-out;
}

.capture-modal__roll-summary {
  display: grid;
  justify-content: center;
  justify-items: center;
  gap: 0.55rem;
  padding: 0 1.25rem 1.25rem;
  color: var(--ink-bright);
  font-weight: 800;
}

.capture-modal__roll-summary strong {
  font-weight: 950;
}

.capture-modal__roll-row {
  visibility: hidden;
}

.capture-modal__roll-row.is-visible {
  visibility: visible;
}

.capture-modal__actions {
  display: flex;
  justify-content: center;
  padding: 0 1.25rem 1.5rem;
}

.capture-modal__dismiss {
  min-width: 9rem;
  border: 1px solid rgba(var(--accent-rgb), 0.72);
  padding: 0.75rem 1.45rem;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.18), transparent 32%),
    linear-gradient(135deg, var(--accent), var(--accent-muted));
  color: var(--ink-bright);
  cursor: pointer;
  font-weight: 950;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  transition: transform 0.16s ease, filter 0.16s ease;
}

.capture-modal__dismiss:hover,
.capture-modal__dismiss:focus-visible {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.capture-modal__dismiss:focus-visible {
  outline: 2px solid rgba(var(--accent-rgb), 0.82);
  outline-offset: 3px;
}

.capture-modal__roll-number.is-success {
  color: var(--good);
}

.capture-modal__roll-number.is-failure {
  color: var(--bad);
}

.capture-modal__rate-number {
  color: #b56cff;
}

@keyframes capture-ball-shake {
  0%, 100% { transform: translateX(0) rotate(0deg); }
  20% { transform: translateX(-0.45rem) rotate(-16deg); }
  50% { transform: translateX(0.45rem) rotate(16deg); }
  78% { transform: translateX(-0.18rem) rotate(-7deg); }
}

@keyframes capture-ball-pop {
  0% { transform: scale(1); }
  45% { transform: scale(1.12); }
  100% { transform: scale(1); }
}

@media (max-width: 720px) {
  .capture-modal__stage {
    grid-template-columns: 1fr;
  }
}
</style>
