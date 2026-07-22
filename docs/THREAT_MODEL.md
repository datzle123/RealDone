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
| Browser action | Can mutate real state | local/test host defaults, explicit host/external/destructive flags, canaries, cleanup ledger |
| PostgreSQL | Credential grants real database authority | environment-only URL/CA, TLS policy, read-only transactions, allowlisted identifiers, parameterized values |
| Database cleanup | Destructive by design | triple confirmation, exact cleanup keys, max-row rollback, dedicated transaction |
| Coding agent/build | Can edit and execute repository code | clean-worktree gate, shell-free spawn, time/output bounds, sealed baseline, contract hashes, independent verification |
| Plugin/provider | Trusted executable code | explicit manifest, relative entry, schema validation, one-call worker, timeout/memory limits, output redaction |
| Reports/logs | May contain application content | known/environment-secret redaction, ignored local output tree, no credential values by design |

## Evidence-integrity threats

- **Agent claims completion:** stdout/stderr are operational logs only and never feed a verdict.
- **Agent edits the baseline:** the pre-agent baseline is hash-sealed, restored before comparison, and the run fails integrity.
- **Agent edits behavior contracts:** files are independently hashed; changes force all flows to run and fail by default unless policy explicitly permits contract changes.
- **Plugin invents a verdict:** plugins return a typed observation; RealDone validates it and computes pass/fail. A malicious trusted plugin can still lie about `found`, so plugin provenance remains part of the trust model.
- **UI false success:** browser/network/refresh/source/provider/cross-role evidence remains separate from UI claims.

## Residual risks

- Worker threads are resource/fault isolation, not OS sandboxes. A malicious plugin can read files, environment variables, or use the network.
- A coding agent or build command can execute code with its configured process authority. Use a disposable branch/worktree and external sandbox when the repository is untrusted.
- Browser automation can trigger an incorrectly classified business action. Review policies and use sandbox accounts.
- Redaction cannot recognize every domain-specific secret or private data format. Treat local reports and logs as sensitive.
- Cross-role checks demonstrate one configured observation, not exhaustive authorization or tenant isolation.
- Provider adapters demonstrate what the trusted provider plugin observed, not real-world delivery beyond that provider's boundary.

Report security issues through GitHub private vulnerability reporting as described in [SECURITY.md](../SECURITY.md).
