# RealDone documentation

RealDone is a local-first runtime behavioral verifier. Start with the [project README](../README.md), then use the focused guides below.

- [Normative full-product specification](PRODUCT_SPECIFICATION.md) — source of truth for product scope, behavior, quality, roadmap intent, and release gates.
- [Current product status](PRODUCT_STATUS.md) — evidence-based implemented/partial/planned snapshot against the specification.
- [Architecture](ARCHITECTURE.md) — core pipeline and extension boundaries.
- [Behavior contracts](CONTRACTS.md) — record, edit, and replay deterministic flows.
- [Baseline and CI](CI.md) — regression manifests, affected flows, and GitHub Action usage.
- [Database adapters](DATABASE_ADAPTERS.md) — SQLite, PostgreSQL, Supabase, Firebase, MongoDB, and Prisma/custom source checks and cleanup.
- [PostgreSQL](POSTGRESQL.md) — production-like PostgreSQL configuration and Level 6 source-of-truth checks.
- [Provider adapters](PROVIDERS.md) — maintained Stripe, email, storage, OAuth, and custom provider checks.
- [Coding-agent verification](AGENT_VERIFICATION.md) — independent baseline → agent → rebuild → verify orchestration.
- [Advanced verification](ADVANCED.md) — roles, Level 7 evidence, browser matrices, and provider contracts.
- [Plugin SDK](PLUGIN_SDK.md) — provider/source extension manifests, runtime APIs, permissions, and worker limits.
- [Performance](PERFORMANCE.md) — enforceable budgets and benchmark dashboard.
- [Compatibility](COMPATIBILITY.md) — release-gated operating systems, Node versions, browsers, and integrations.
- [Threat model](THREAT_MODEL.md) — trust boundaries, mitigations, and residual risk.
- [Functional verification matrix](VERIFICATION_MATRIX.md) — public capabilities mapped to executable release gates.
- [Real-world validation](REAL_WORLD_VALIDATION.md) — reproducible scans against external open-source applications.
- [Roadmap](ROADMAP.md) — shipped foundation, active work, remaining full-product phases, and their executable gates.
