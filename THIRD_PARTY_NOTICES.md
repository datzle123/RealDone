# Third-party notices

RealDone is distributed under the MIT License. It uses third-party packages through their public APIs; no third-party source has been copied into the RealDone source tree unless a future notice explicitly says so.

| Component | Purpose | License | Source |
| --- | --- | --- | --- |
| Commander.js | CLI parsing and help | MIT | https://github.com/tj/commander.js |
| jsondiffpatch | Structured behavior-manifest delta | MIT | https://github.com/benjamine/jsondiffpatch |
| node-postgres (`pg`) | Optional PostgreSQL source-of-truth adapter | MIT | https://github.com/brianc/node-postgres |
| Playwright | Chromium automation and browser evidence | Apache-2.0 | https://github.com/microsoft/playwright |
| rrweb | Masked local DOM/session event recording | MIT | https://github.com/rrweb-io/rrweb |
| Zod | Runtime validation for policies, ledgers, and benchmark contracts | MIT | https://github.com/colinhacks/zod |

`pg` is loaded through its public API only when the PostgreSQL adapter is configured. No node-postgres source is copied into this repository.
