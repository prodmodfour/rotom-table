# Legacy parser and provenance tree — retained and labelled

**Distribution status:** retained by explicit owner disposition at P13-058 on 2026-08-27.

This tree contains historical parser inputs, parser utilities, and generator support. It is documentary/provenance material, not Rotom Table runtime authority. Production application code must not import, spawn, or read it.

The supported JSON-era campaign conversion boundary is `npm run migrate:sqlite`; operators must not invoke this tree as a substitute. Runtime PTU data comes only from `data/reference/*.json` and `shared/ruleset/natures.ts`.

Reviewed manifests and archived acceptance evidence bind selected files here by path and SHA-256. Retention preserves those audit trails without granting the parser output authority over app-owned canonical data.

Pokémon, Pokémon Tabletop United, and other third-party material represented here are outside Rotom Table's license grant. See [`../LICENSE`](../LICENSE), [`../NOTICE.md`](../NOTICE.md), and [`../docs/fan-project-notice.md`](../docs/fan-project-notice.md).

Do not add private campaign data, credentials, or operator output to this tree.
