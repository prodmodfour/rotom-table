# Move automation release acceptance record

Date: 2026-07-20

Scope: repository and local production-like acceptance for the frozen 776-move ruleset. This record does not claim or perform a production deployment; production app code remains deployed by the user through the GitHub release path.

## Automated acceptance

`bash scripts/quality-gate.sh` passed on the retirement implementation and included:

- shell, secret, and generated/private-file guardrails;
- metadata validation: 776/776 canonical rows, 776 complete, zero assisted, zero blocked;
- strict canonical completion audit and definition/source/hash checks;
- engine performance budgets;
- menu-status and retained backup-fingerprint checks;
- TypeScript/Nuxt typechecking;
- 921 test files and 7,494 tests;
- a production Nuxt/Nitro build.

The full suite includes SQLite import/export and backup behavior, JSON terminal abandonment of pending prompts, multi-resource revision conflicts, duplicate delivery, three-client chaos/reconnect, restart recovery, hidden-information/privacy, authorization, response-window reconciliation, and performance-budget coverage.

The 33 registered conformance batches passed 1,666 scenarios after runtime retirement. Their assertions retain hit, miss, critical, immunity, natural Effect Range, stage caps, area/pass geometry, Smite, dynamic HP/damage, resource, replay, and stale-state mechanics; only retired runtime identities and legacy prose-only evidence shapes were migrated to structured MoveSpec evidence.

## Local production-like browser smoke

A fresh production build was started through `../bin/start-prodlike.sh` and passed `/api/health`. Three independent Playwright browser contexts were used:

1. A GM context logged in, loaded `/maps`, and loaded the GM-only `/players` profile-management surface.
2. A player context selected a temporary unlinked profile, loaded `/maps`, saw only the player navigation surface, and saw no player-visible maps or GM profile-management link.
3. An unauthenticated/ineligible context requesting `/maps` was redirected to `/login?redirect=/maps` and had no GM navigation.

All three contexts reported zero browser console errors or warnings. The temporary local profile was removed and the production-like service was stopped after the smoke.

The campaign-specific move matrix remains repeatable from [Move automation operator recovery and manual QA](move-automation-manual-qa.md). Its mechanical, conflict, restart, reconnect, and privacy branches are also represented by executable repository scenarios above, so no private campaign data is required as a test fixture.

## Runtime retirement acceptance

- Every canonical manifest row selects `movespec-v2` version 2.
- The production runtime registry has no legacy execution sources.
- Strict completion rejects a selected `legacy-v1` canonical runtime.
- Explicit test-only migration registries continue to prove deterministic legacy projection and backup compatibility; they cannot reach production persistence.
- New accepted commands write only current MoveSpec results and canonical encounter state.
- Historical accepted-result and backup readers remain covered for the documented compatibility window.
- Rollback uses the normal prior application release and SQLite backup process; runtime retirement deletes or rewrites no private campaign state.

`interactionStatus` remains separately `unassessed` for the catalog by design. Base completion includes every interaction directly required by a move's own canonical text, while unrelated ecosystem-wide ability/item/feature combinations are outside the 776 base-move closure target defined by ADR 010. No row hides a known unsupported interaction behind prose or manual debt.
