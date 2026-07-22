# Security policy

## Supported versions

Until the `v1.0.0` release, security fixes are applied to the latest release line.

## Reporting a vulnerability

Please use GitHub private vulnerability reporting for the repository. Do not open a public issue for credential leakage, unsafe action execution, sandbox escape, report redaction failure, or dependency compromise.

Include the smallest safe reproduction, affected version, expected safety boundary, and observed behavior. Do not include live secrets or production customer data.

## Safety boundary

RealDone drives a real browser. The default policy limits mutations to local/test hosts and blocks destructive and external effects. Opt-in flags are explicit authorization, not a guarantee that an action is harmless. Use disposable test data and staging credentials.
