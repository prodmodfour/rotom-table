<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ItemSprite from '~/components/ItemSprite.vue'
import {
  playPokeballFailSound,
  playPokeballShakeSound,
  playPokeballSuccessSound,
  playPokeballThrowSound,
} from '~/utils/pokeballSoundEffects'
import type { PokeballCaptureAttemptResult, PokeballCaptureBreakdownLine } from '~/utils/pokeballCapture'

const props = defineProps<{
  result: PokeballCaptureAttemptResult
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

const currentShake = ref(0)
const done = ref(false)
const timers: Array<ReturnType<typeof setTimeout>> = []

const signedValue = (value: number): string => value > 0 ? `+${value}` : String(value)

const captureRateLineValueClass = (line: PokeballCaptureBreakdownLine): string => {
  if (line.value > 0) return 'is-good'
  if (line.value < 0) return 'is-bad'
  return ''
}

const rollModifierLineValueClass = (line: PokeballCaptureBreakdownLine): string => {
  if (line.value < 0) return 'is-good'
  if (line.value > 0) return 'is-bad'
  return ''
}

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
  void playPokeballThrowSound()

  if (!props.result.hit || props.result.shakeCount <= 0) {
    schedule(() => {
      done.value = true
      void playPokeballFailSound()
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
  }, 520 + (props.result.shakeCount * 720))
}

watch(() => props.result.id, () => startAnimation())

onMounted(startAnimation)
onBeforeUnmount(clearTimers)
</script>

<template>
  <Teleport to="body">
    <div class="capture-modal-backdrop" @click.self="emit('close')">
      <section class="capture-modal" role="dialog" aria-modal="true" aria-label="Poké Ball capture result">
        <header class="capture-modal__header">
          <button class="capture-modal__close" type="button" aria-label="Close" @click="emit('close')">×</button>
        </header>

        <div class="capture-modal__stage" :class="{ 'is-done': done, 'is-success': result.success && done, 'is-failure': !result.success && done }">
          <div class="capture-modal__portrait">
            <img v-if="result.targetSpriteUrl" :src="result.targetSpriteUrl" :alt="result.targetName" loading="lazy">
            <span v-else>{{ result.targetSpecies }}</span>
          </div>

          <div class="capture-modal__ball-wrap" :key="currentShake">
            <div class="capture-modal__ball" :class="{ 'is-shaking': currentShake > 0 && !done }">
              <ItemSprite :item="result.pokeballName" :alt="result.pokeballName" size="xl" />
              <span class="capture-modal__fallback-ball" aria-hidden="true" />
            </div>
            <p class="capture-modal__ball-label">{{ result.pokeballName }}</p>
          </div>
        </div>

        <div class="capture-modal__breakdown-grid">
          <section class="capture-modal__breakdown">
            <h3>Capture Rate Breakdown</h3>
            <dl>
              <template v-for="(line, index) in result.breakdown.captureRateLines" :key="`${line.label}-${line.value}-${index}`">
                <dt>{{ line.label }}</dt>
                <dd :class="captureRateLineValueClass(line)">{{ signedValue(line.value) }}</dd>
                <dd v-if="line.detail" class="capture-modal__detail">{{ line.detail }}</dd>
              </template>
            </dl>
          </section>

          <section class="capture-modal__breakdown">
            <h3>Capture Roll Modifiers</h3>
            <dl>
              <template v-for="(line, index) in result.breakdown.rollModifierLines" :key="`${line.label}-${line.value}-${index}`">
                <dt>{{ line.label }}</dt>
                <dd :class="rollModifierLineValueClass(line)">{{ signedValue(line.value) }}</dd>
                <dd v-if="line.detail" class="capture-modal__detail">{{ line.detail }}</dd>
              </template>
            </dl>
            <p v-if="result.breakdown.notes.length" class="capture-modal__note">
              {{ result.breakdown.notes.join(' ') }}
            </p>
          </section>
        </div>

        <footer class="capture-modal__footer">
          <p>
            {{ result.breakdown.hitChance.title }}
          </p>
          <button class="capture-modal__button" type="button" @click="emit('close')">Close</button>
        </footer>
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
  background: rgba(0, 0, 0, 0.56);
  backdrop-filter: blur(6px);
}

.capture-modal {
  width: min(860px, 100%);
  max-height: min(92vh, 920px);
  overflow: auto;
  border: 1px solid var(--rule-strong);
  border-radius: 22px;
  background:
    radial-gradient(circle at 18% 12%, rgba(255, 255, 255, 0.14), transparent 32%),
    color-mix(in srgb, var(--paper) 96%, black 4%);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.52);
  color: var(--ink);
}

.capture-modal__header {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  padding: 1.15rem 1.25rem 0.75rem;
  border-bottom: 1px solid var(--rule);
}

.capture-modal__close {
  width: 2.1rem;
  height: 2.1rem;
  border: 1px solid var(--rule-strong);
  border-radius: 999px;
  background: var(--paper-accent);
  color: var(--ink);
  cursor: pointer;
}

.capture-modal__stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(8rem, 0.8fr);
  gap: 1rem;
  align-items: center;
  padding: 1.25rem;
}

.capture-modal__portrait {
  display: grid;
  min-height: 13rem;
  place-items: center;
  border: 1px solid var(--rule);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
}

.capture-modal__portrait img {
  max-width: min(100%, 18rem);
  max-height: 13rem;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.5));
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

.capture-modal__ball-label {
  margin: 0;
  color: var(--ink-bright);
  font-weight: 900;
}

.capture-modal__stage.is-success .capture-modal__ball,
.capture-modal__stage.is-failure .capture-modal__ball {
  animation: capture-ball-pop 0.35s ease-out;
}

.capture-modal__breakdown-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
  padding: 0 1.25rem 1rem;
}

.capture-modal__breakdown {
  border: 1px solid var(--rule);
  border-radius: 14px;
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.04);
}

.capture-modal__breakdown h3 {
  margin: 0 0 0.55rem;
  color: var(--ink-bright);
  font-size: 0.92rem;
}

.capture-modal__breakdown dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.35rem 0.7rem;
  margin: 0;
  font-size: 0.8rem;
}

.capture-modal__breakdown dt {
  color: var(--muted);
}

.capture-modal__breakdown dd {
  margin: 0;
  color: var(--ink);
  font-weight: 900;
}

.capture-modal__breakdown dd.is-good {
  color: var(--good);
}

.capture-modal__breakdown dd.is-bad {
  color: var(--bad);
}

.capture-modal__detail,
.capture-modal__note {
  grid-column: 1 / -1;
  color: var(--muted);
  font-size: 0.75rem;
}

.capture-modal__note {
  margin: 0.65rem 0 0;
}

.capture-modal__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.25rem 1.15rem;
  border-top: 1px solid var(--rule);
}

.capture-modal__footer p {
  margin: 0;
  color: var(--muted);
  font-size: 0.78rem;
}

.capture-modal__button {
  border: 1px solid var(--rule-strong);
  border-radius: 999px;
  background: var(--accent);
  color: var(--ink-bright);
  padding: 0.5rem 0.85rem;
  font-weight: 900;
  cursor: pointer;
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
  .capture-modal__stage,
  .capture-modal__breakdown-grid {
    grid-template-columns: 1fr;
  }

  .capture-modal__footer {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
