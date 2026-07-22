# Architecture

RealDone is a deterministic runtime verifier. Its core does not need an LLM, database credential, cloud account, hosted dashboard, framework integration, or coding-agent API.

## Runtime pipeline

1. **Runtime manager** launches one isolated Chromium process.
2. **Route and action discovery** crawls same-origin pages and fingerprints visible forms, links, and buttons.
3. **Safety policy** classifies actions as safe, external, or destructive and enforces host policy.
4. **Test data generator** creates unique canaries based on field semantics.
5. **Safe action executor** re-opens each page in an isolated context, resolves the action, fills supported fields, and performs one interaction.
6. **Evidence collector** records request/response timing, console/page errors, URL/DOM/storage digests, UI claims, dialogs, and downloads.
7. **Persistence verifier** reloads mutation pages and searches for the same canary or deleted target.
8. **Detector engine** converts factual evidence into stable detector matches and a verdict.
9. **Report/replay layer** writes HTML, JSON, network logs, screenshots, and one deterministic reproduction contract per finding.

The reliability layer wraps the pipeline with a global deadline, per-operation retry bounds, weighted locator diagnostics, checked-in action policy, cleanup ledger, and benchmark evaluator. Retries never repeat an action after the click/submit boundary because that could create duplicate mutations.

## Design constraints

- Evidence objects are serializable, versioned, and secret-redacted.
- A verdict describes only the evidence level reached; `VERIFIED` is not a claim that all business rules are correct.
- `UNCERTAIN` is a valid terminal state.
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
- `SourceOfTruthAdapter`: read-back and cleanup against a database or provider.
- `AgentAdapter`: run an agent command, capture changed files, and select affected behavior contracts.
- `RealDonePlugin`: register action classifiers, input providers, verifiers, detectors, and reporters.

Each extension must remain optional and must fail closed when it cannot establish evidence.

### Recorder boundary

rrweb supplies masked raw session evidence only. RealDone separately records a compact, versioned behavior contract. Verification resolves each semantic fingerprint, performs one step, observes network/UI outcomes, checks explicit expectations, and stops after the first failure by default. This separation prevents an implementation detail of the session recorder from becoming the regression contract.

### Baseline boundary

The baseline stores canonical contract hashes and compact pass/fail assertion outcomes, not browser traces or credentials. The regression gate verifies current behavior first, then uses a structured manifest delta to explain contract changes. A changed contract is not automatically a regression; pass-to-fail and missing passing contracts are.

### Source-of-truth boundary

The first `SourceOfTruthAdapter` implementation targets PostgreSQL and is loaded only when a contract contains a `source` expectation and verification receives `--postgres-config`. Credentials and CA material come from named environment variables and never enter contracts, manifests, ledgers, or reports. Read-back runs in a `READ ONLY` transaction. Dynamic values use PostgreSQL parameters; identifiers can only come from validated resource mappings.

Database cleanup is a separate read-write transaction and is intentionally harder to enable than verification. It requires `--confirm`, `--confirm-database`, `allowCleanup: true`, and the exact configured cleanup-key fields. A zero-row delete is successful so rerunning cleanup remains idempotent.

### Coding-agent boundary

`AgentAdapter` launches Codex, Claude Code, or a structured generic command without a shell. The orchestration pipeline first captures a green behavior baseline, records the Git HEAD/worktree state, runs the agent, rebuilds through a separate command, derives committed and uncommitted changed files, and then invokes the ordinary affected-flow regression gate.

Agent stdout, stderr, exit messages, and completion claims are operational logs only. They never become browser, network, persistence, database, or cross-user evidence. The pre-agent baseline is hash-sealed and restored after tampering; behavior contracts are hashed independently and cannot change in a passing run without explicit policy. A failed pipeline generates its follow-up prompt exclusively from integrity failures, rebuild diagnostics, and independently observed RealDone assertions.
