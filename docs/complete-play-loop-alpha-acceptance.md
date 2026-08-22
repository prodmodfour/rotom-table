# Complete Play Loop alpha product acceptance

P8-100 is the final acceptance record for Rotom Table's primary alpha campaign loop. The machine-readable record is `data/complete-play-loop/alpha-product-acceptance.v1.json`.

**Status: accepted.** All 100 tickets are complete, the plan is archived, all 349 canonical item rows have a reviewed complete state, and the primary trusted-table liveplay loop has no critical usability debt. The same-revision repository quality gate passed 1,524 Vitest files with 11,008 tests, two Nuxt files with seven tests, 79 Playwright journeys with one intentional skip, ESLint, typecheck, production build, generators, focused gates, and the final whitespace check.

Acceptance requires all of the following at the same revision:

- all 100 Complete Play Loop tickets are `DONE` and the plan is archived;
- all ordered implementation plans are `DONE`;
- all 349 canonical items are complete: 205 native, 40 guided, 104 passive, zero blocked;
- authority drift, orphan handlers/providers, client mechanic mutation, unreviewed inventory writes, and unowned settlement fields fail validation;
- lower-end-laptop, mobile, and large-campaign budgets pass;
- keyboard, screen-reader, touch, zoom, reflow, contrast, reduced motion, table-distance, desktop, and mobile acceptance has no hard failure;
- duplicate, stale, moved-row, reservation, reconnect, restart, partial-failure, retry, and correction acceptance proves exactly-once outcomes;
- three golden campaigns cover all 21 canonical fixtures for GM and player-owner without runtime storage repair;
- player, GM, contributor, and operator documentation is complete and link-valid;
- generator drift, focused gates, full tests, lint, typecheck, production build, and the repository quality gate pass;
- no critical usability debt remains in acquire → inventory/equipment/use → encounter → settlement → attention/recovery → next day → next scene.

## Product boundary

This acceptance is for the trusted-table alpha and its liveplay runtime. It is not a public-service hardening claim, release announcement, repository promotion, or a promise that unrelated future campaign modes are complete.

Canonical PTU runtime data remains app-owned. Ambiguous mechanics still fail closed. A complete alpha does not permit runtime prose parsing, direct storage repair, client-owned mechanics, automatic reconnect replay, or private authority leakage.

## Validation discipline

The acceptance record stores exact command results and SHA-256 evidence. Do not change a source fingerprint or mark a pending gate passed by hand. Regenerate the owning artifact, run its focused command, then rerun downstream closure.

Full validation runs one bounded worker where supported. Production browser evidence remains the accepted desktop/mobile liveplay evidence from the owning journeys; failures are fixed rather than recorded as alpha exceptions.
