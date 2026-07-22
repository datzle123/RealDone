# Contributing

RealDone values findings that are correct, explainable, and reproducible.

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

## Pull requests

- Keep changes scoped and add/update tests.
- Run `pnpm check` and `pnpm smoke`.
- Update `CHANGELOG.md` for user-visible changes.
- Add third-party licenses to `THIRD_PARTY_NOTICES.md`.
- Never commit credentials, auth state, reports containing real user data, or production URLs.
