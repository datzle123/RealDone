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
