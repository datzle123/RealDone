# Contributing

RealDone values findings that are correct, explainable, and reproducible.

## Product source of truth

Read [`docs/PRODUCT_SPECIFICATION.md`](docs/PRODUCT_SPECIFICATION.md), [`docs/PRODUCT_STATUS.md`](docs/PRODUCT_STATUS.md), and [`docs/ROADMAP.md`](docs/ROADMAP.md) before proposing product scope. The specification wins when another document conflicts. A capability is not complete because a type, skeleton, fixture-only path, or README claim exists; it needs observable production behavior and an executable gate.

## Development setup

```bash
corepack enable
pnpm install
pnpm exec playwright install chromium
pnpm check
pnpm smoke
```

## Detector changes

Every detector change should include:

1. an intentionally broken fixture;
2. a correct control that must not be flagged;
3. an evidence timeline and stable detector code;
4. a deterministic reproduction;
5. a unit test plus browser smoke coverage where relevant.

Do not infer business intent when observable evidence is insufficient. Return `UNCERTAIN` and explain which verifier or contract would resolve it.

Recorder changes must preserve input masking, auth-state warnings, contract schema compatibility, and the separation between raw rrweb evidence and deterministic RealDone steps.

## Pull requests

- Identify the affected normative specification sections and roadmap phase.
- Keep changes scoped and add/update tests.
- Run `pnpm check`, `pnpm audit --audit-level high`, `pnpm smoke`, and `pnpm pack`.
- Update `CHANGELOG.md` for user-visible changes.
- Update `docs/PRODUCT_STATUS.md` only when executable evidence changes its facts.
- Add third-party licenses to `THIRD_PARTY_NOTICES.md`.
- Never commit credentials, auth state, reports containing real user data, or production URLs.

The full-product release bar is the 15-gate checklist in specification §29. Missing gates keep the affected capability `PARTIAL`; they are not documentation waivers.
