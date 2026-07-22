# Architecture

RealDone is a deterministic runtime verifier. Its core does not need an LLM, database credential, cloud account, hosted dashboard, framework integration, or coding-agent API.

## Runtime pipeline

1. **Runtime manager** launches one isolated Chromium process.
2. **Route and action discovery** crawls same-origin pages and fingerprints visible forms, links, buttons, and semantically likely standalone Enter-submit inputs.
3. **Safety policy** classifies actions as safe, external, or destructive from semantic/form/endpoint signals, enforces host policy, and rechecks the live target immediately before execution.
4. **Test data generator** creates unique canaries based on field semantics.
5. **Safe action executor** re-opens each page in an isolated context, resolves the action, fills supported fields, and performs one interaction.
6. **Evidence collector** records request/response timing, console/page errors, URL/DOM/live-control/storage digests, UI claims, dialogs, and downloads.
7. **Persistence verifier** reloads mutation pages and, in deep mode, repeats the read-back in a fresh browser context.
8. **Detector engine** converts factual evidence into stable detector matches and a verdict.
9. **Report/replay layer** writes HTML, JSON, dedicated network/snapshot/console/WebSocket/upload/download evidence, screenshots, optional trace/video, one deterministic reproduction contract per finding, and an explicit fresh-execution replay outcome.

The reliability layer wraps the pipeline with a global deadline, per-operation retry bounds, weighted locator diagnostics, checked-in action policy, cleanup ledger, and benchmark evaluator. Retries never repeat an action after the click/submit boundary because that could create duplicate mutations.

## Design constraints

- Evidence objects are serializable, versioned, and secret-redacted.
- A verdict describes only the evidence level reached; `VERIFIED` is not a claim that all business rules are correct.
- `UNCERTAIN` is a valid terminal state.
- Semantic locator resolution never substitutes a different element by DOM ordinal. Ordinals remain readable for schema compatibility and diagnostics only; if the named target is absent, the action is not executed and the result is `UNCERTAIN`.
- Production-like hosts are discovery-only until explicitly allowed.
- Optional extensions depend on core contracts; core never depends on an extension.

## Evidence levels

| Level | Proof |
| --- | --- |
| 0 | UI claim only |
| 1 | Action initiated / visible local effect |
| 2 | Request observed |
| 3 | Backend accepted the request |
| 4 | API read-back confirmed |
| 5 | Persistence after reload/new page confirmed |
| 6 | Source-of-truth adapter confirmed |
| 7 | Another role/user confirmed |

## Extension contracts

Later phases add four interfaces around the core evidence model:

- `BehaviorContract`: recorded steps, semantic locators, assertions, cleanup, tags, and ownership.
- `SourceOfTruthAdapter`: read-back, schema/snapshot evidence, and cleanup against a database.
- `AgentAdapter`: run an agent command, capture changed files, and select affected behavior contracts.
- `RealDonePlugin`: register custom provider observations and Prisma/custom source operations.

Each extension must remain optional and must fail closed when it cannot establish evidence.

### Recorder boundary

rrweb supplies masked raw session evidence only. RealDone separately records a compact, versioned behavior contract. Verification resolves each semantic fingerprint, performs one step, observes network/UI outcomes, checks explicit expectations, and stops after the first failure by default. This separation prevents an implementation detail of the session recorder from becoming the regression contract.

### Baseline boundary

The baseline stores canonical contract hashes and compact pass/fail assertion outcomes, not browser traces or credentials. The regression gate verifies current behavior first, then uses a structured manifest delta to explain contract changes. A changed contract is not automatically a regression; pass-to-fail and missing passing contracts are.

### Source-of-truth boundary

Source adapters are loaded only when a contract contains a matching `source` expectation. SQLite is zero-config and query-only/read-only by default. PostgreSQL uses a `READ ONLY` transaction and explicit TLS policy; Supabase, Firebase and MongoDB use versioned mappings, bounded remote access and production guards. Prisma/custom databases use a reviewed project-owned plugin because generated clients and schemas are project-specific. Credentials and CA material come from named environment variables and never enter contracts, manifests, ledgers, or reports. Dynamic values are parameterized or encoded through mapped query APIs; identifiers/fields come only from discovered or validated mappings. Schema, primary-key and soft-delete metadata plus row hashes support value-free snapshots and diffs.

Database cleanup uses a separate write path and is intentionally harder to enable than verification. It requires `--confirm`, `--confirm-database`, the matching adapter/plugin, adapter cleanup opt-in where configurable, and exact key fields. A zero-row delete is successful so rerunning cleanup remains idempotent.

### Provider boundary

Maintained Stripe-test, email, object-storage and OAuth adapters perform only bounded lookup, `HEAD`, or introspection operations. Production-like endpoints are blocked by default, and Stripe live keys are never accepted. Custom provider plugins return typed observations; core validates/redacts them and computes the verdict. Provider and source plugins run in fresh workers with time/memory limits and declared environment/global-`fetch` permissions, but remain trusted code rather than an OS security sandbox.

### Coding-agent boundary

`AgentAdapter` launches Codex, Claude Code, or a structured generic command without a shell. The orchestration pipeline first captures a green behavior baseline, records the Git HEAD/worktree state, runs the agent, rebuilds through a separate command, derives committed and uncommitted changed files, and then invokes the ordinary affected-flow regression gate.

Agent stdout, stderr, exit messages, and completion claims are operational logs only. They never become browser, network, persistence, database, or cross-user evidence. The pre-agent baseline is hash-sealed and restored after tampering; behavior contracts are hashed independently and cannot change in a passing run without explicit policy. Changed-file attribution and affected-flow selection use the final post-build Git state, so build-generated product files cannot escape verification. A failed pipeline generates its follow-up prompt exclusively from integrity failures, rebuild diagnostics, and independently observed RealDone assertions.
