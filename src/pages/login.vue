<script setup lang="ts">
import type { AuthRole } from '#shared/auth'
import { resolveLoginRedirectTarget } from '~/utils/loginRedirect'

useHead({ title: 'Login · Rotom Table' })

const route = useRoute()
const router = useRouter()
const { role, roleLabel, loginAs } = useAuth()

const redirectTarget = (nextRole: AuthRole) =>
  resolveLoginRedirectTarget(route.query.redirect, nextRole)

const chooseRole = async (nextRole: AuthRole) => {
  loginAs(nextRole)
  await router.replace(redirectTarget(nextRole))
}
</script>

<template>
  <main class="login-page">
    <section class="login-card" aria-labelledby="login-title">
      <p class="eyebrow">Rotom Table</p>
      <h1 id="login-title">Choose a login</h1>
      <p class="login-copy">
        For now this uses the table's trust system: no passwords, just pick the role
        you are using for local-first access.
      </p>

      <div class="login-actions" role="group" aria-label="Login options">
        <button type="button" class="login-button login-button--gm" @click="chooseRole('gm')">
          <span>GM Login</span>
          <small>Full map, sheet, encounter, and control-panel access</small>
        </button>
        <button type="button" class="login-button" @click="chooseRole('player')">
          <span>Player Login</span>
          <small>One shared player login with player-visible maps and sheets</small>
        </button>
      </div>

      <p v-if="role" class="current-role">
        Current login: <strong>{{ roleLabel }}</strong>
      </p>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1rem;
  background:
    radial-gradient(circle at top, rgba(255, 31, 45, 0.12), transparent 34rem),
    var(--paper);
}

.login-card {
  width: min(560px, 100%);
  border: 1px solid var(--rule);
  border-radius: 18px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 1.35rem;
}

.eyebrow {
  margin: 0 0 0.35rem;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-family: var(--font-book);
  font-size: clamp(2rem, 8vw, 3rem);
  color: var(--ink-bright);
}

.login-copy {
  margin: 0.75rem 0 1.1rem;
  color: var(--ink-soft);
  line-height: 1.55;
}

.login-actions {
  display: grid;
  gap: 0.7rem;
}

.login-button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.9rem 1rem;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}

.login-button:hover,
.login-button:focus-visible {
  border-color: var(--accent);
  background: var(--paper-hover);
  outline: none;
  transform: translateY(-1px);
}

.login-button--gm {
  border-color: rgba(255, 31, 45, 0.6);
  background: var(--accent-soft);
}

.login-button span {
  color: var(--ink-bright);
  font-size: 1.05rem;
  font-weight: 700;
}

.login-button small {
  color: var(--ink-muted);
  line-height: 1.35;
}

.current-role {
  margin: 1rem 0 0;
  color: var(--ink-muted);
}

.current-role strong {
  color: var(--accent);
}
</style>
