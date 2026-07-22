# Threat model

RealDone executes browsers, test actions, database reads, optional cleanup, provider plugins, build commands, and coding agents. Its safety boundary assumes a trusted local or isolated CI machine and disposable local/staging data.

## Assets

- source code and Git history;
- auth storage state, database/provider credentials, and agent credentials;
- test/staging data and external sandbox objects;
- integrity of baselines, contracts, evidence, and verdicts;
- CI capacity and developer workstation availability.

## Trust boundaries

| Boundary | Trust assumption | Main controls |
| --- | --- | --- |
| Application under test | Potentially buggy or hostile content | same-origin discovery, action policy, time budgets, secret-redacted evidence |
| Browser action | Can mutate real state | one-question project consent (or explicit non-interactive authorization), local/test host defaults, separate host/external/destructive flags, discovery plus live pre-execution reclassification, canaries, cleanup ledger |
| Database source | Credential/file grants real data authority | SQLite query-only/read-only handles; environment-only remote credentials; explicit TLS/remote policy; mapped identifiers/fields; parameterized values; hashed snapshots |
| Database cleanup | Destructive by design | CLI and database confirmation, adapter opt-in, exact primary keys, maximum-row guards, dedicated write path |
| Coding agent/build | Can edit and execute repository code | clean-worktree gate, shell-free spawn, time/output bounds, sealed baseline, contract hashes, independent verification |
| Plugin/provider | Trusted executable code or remote credential | read-only maintained adapters; explicit plugin manifest/permissions; relative entry; schema validation; one-call worker; timeout/memory limits; output redaction |
| Reports/logs | May contain application content | known/environment-secret redaction, ignored local output tree, no credential values by design |

## Evidence-integrity threats

- **Agent claims completion:** stdout/stderr are operational logs only and never feed a verdict.
- **Agent edits the baseline:** the pre-agent baseline is hash-sealed, restored before comparison, and the run fails integrity.
- **Agent edits behavior contracts:** files are independently hashed; changes force all flows to run and fail by default unless policy explicitly permits contract changes.
- **Plugin invents a verdict:** plugins return a typed observation; RealDone validates it and computes pass/fail. A malicious trusted plugin can still lie about `found`, so plugin provenance remains part of the trust model.
- **UI false success:** browser/network/refresh/source/provider/cross-role evidence remains separate from UI claims.
- **Release summary detached from its run:** external-case evidence is accepted only when its repository-confined raw `scan.json` exists, matches the recorded SHA-256, and agrees exactly with the published scan counters and verdict map.

## Residual risks

- Worker threads are resource/fault isolation, not OS sandboxes. The worker process environment is reduced to declared/referenced names and global `fetch` is host-allowlisted, but malicious plugin code can still read files (including credential files) or use other Node network APIs.
- A coding agent or build command can execute code with its configured process authority. Use a disposable branch/worktree and external sandbox when the repository is untrusted.
- Opaque JavaScript/server handlers without observable form, URL, endpoint, provider, or DOM semantics cannot be classified precisely before execution. CLI/MCP therefore require project-level consent that explicitly warns about hidden provider effects; use a recorded flow or project-specific deny/set policy for narrower authority.
- Redaction cannot recognize every domain-specific secret or private data format. Treat local reports and logs as sensitive.
- Cross-role checks demonstrate one configured observation, not exhaustive authorization or tenant isolation.
- Provider adapters demonstrate what the provider API or trusted custom plugin observed, not real-world delivery beyond that provider's boundary.

Report security issues through GitHub private vulnerability reporting as described in [SECURITY.md](../SECURITY.md).
