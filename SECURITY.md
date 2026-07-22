# Security policy

## Supported versions

Until the `v1.0.0` release, security fixes are applied to the latest release line.

## Reporting a vulnerability

Please use GitHub private vulnerability reporting for the repository. Do not open a public issue for credential leakage, unsafe action execution, sandbox escape, report redaction failure, or dependency compromise.

Include the smallest safe reproduction, affected version, expected safety boundary, and observed behavior. Do not include live secrets or production customer data.

## Safety boundary

RealDone drives a real browser. The default policy limits mutations to local/test hosts and blocks destructive and external effects. Opt-in flags are explicit authorization, not a guarantee that an action is harmless. Use disposable test data and staging credentials.

Recorded password-like inputs are replaced by environment-variable references and rrweb runs with all input masking enabled. Playwright auth-state files contain sensitive cookies and may grant account access; keep them under the ignored `.realdone/` directory, never commit them, and rotate staging credentials after suspected exposure.

PostgreSQL credentials and CA material must be provided through the environment names referenced by the adapter config. Prefer a dedicated least-privilege read-only role. Source verification also opens a read-only transaction. Database cleanup is a separate opt-in path requiring CLI confirmation, config permission, exact allowlisted key fields, and a maximum-row rollback guard; use it only against disposable local or staging data.
