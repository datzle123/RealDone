# RealDone coding-agent instructions

## Normative source

Read [`docs/PRODUCT_SPECIFICATION.md`](docs/PRODUCT_SPECIFICATION.md) before planning or changing product behavior. It is the normative source for product scope, functional semantics, quality requirements, roadmap intent, and release criteria.

Precedence when documents disagree:

1. `docs/PRODUCT_SPECIFICATION.md` — required end state and quality bar.
2. `docs/PRODUCT_STATUS.md` — evidence-based snapshot of what exists now.
3. `docs/ROADMAP.md` — implementation order and phase gates.
4. Focused architecture/user guides.
5. README, issues, comments, and agent-generated plans.

Do not silently narrow the full-product scope. Phases define delivery order, not permission to omit later requirements.

## Status language

Use these meanings consistently:

- `IMPLEMENTED`: production implementation plus automated observable-behavior evidence exists.
- `PARTIAL`: useful implementation exists, but at least one normative behavior or gate is missing.
- `PLANNED`: no production implementation with an executable gate exists.
- `BLOCKED`: an external prerequisite prevents progress and the blocker is documented.

A type, interface, skeleton, fixture-only path, README claim, or passing build is not evidence that a capability is implemented. Never describe RealDone as a completed full product while `docs/PRODUCT_STATUS.md` says otherwise.

## Change workflow

For every product change:

1. Identify the specification section(s) and roadmap phase affected.
2. Inspect current behavior and executable evidence before editing.
3. Add an intentionally broken case and a correct control for detector changes.
4. Implement the smallest general solution; never hard-code an external case-study project.
5. Add deterministic unit/integration/browser coverage at the observable boundary.
6. Update specification, status, roadmap, compatibility, and changelog surfaces when their facts change.
7. Run the applicable release gates and report failures honestly.
8. For each completed phase, commit and push only after its gates pass; a GitHub release requires the hosted cross-platform run to pass.

When external MIT-licensed code can help, reuse only the required module or API. Verify the exact license and version, preserve notices/attribution in `THIRD_PARTY_NOTICES.md`, prefer a maintained dependency or adapter boundary over copied source, and never copy code with unknown or incompatible provenance.

## Release rules

The 15 gates in specification section 29 are mandatory for a full-product release. Current package releases may ship an independently useful subset, but must not imply that missing normative scope is complete.

At minimum, every pull request must pass:

```bash
pnpm check
pnpm audit --audit-level high
pnpm smoke
pnpm pack
```

Also require the relevant database/provider/browser/role integration gate, real-world regression, schema compatibility check, artifact secret scan, cleanup check, and environment-validity gate when the changed scope touches them. If a normative gate does not exist yet, mark the capability `PARTIAL`; do not waive it by documentation.

## Safety and evidence

Production side effects, external navigation, destructive actions, credentials, and raw user data remain fail-closed by default. Agent output is never verification evidence. Prefer `UNCERTAIN`, `SKIPPED`, `BLOCKED`, or `ENVIRONMENT_INVALID` over an unsupported application-defect verdict.
