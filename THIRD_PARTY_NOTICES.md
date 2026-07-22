# Third-party notices

RealDone is distributed under the MIT License. It uses third-party packages through their public APIs; no third-party source has been copied into the RealDone source tree unless a future notice explicitly says so.

| Component | Purpose | License | Source |
| --- | --- | --- | --- |
| better-sqlite3 | Optional zero-config SQLite source-of-truth adapter | MIT | https://github.com/WiseLibs/better-sqlite3 |
| Commander.js | CLI parsing and help | MIT | https://github.com/tj/commander.js |
| cross-spawn | Cross-platform shell-free agent/build process spawning | MIT | https://github.com/moxystudio/node-cross-spawn |
| jsondiffpatch | Structured behavior-manifest delta | MIT | https://github.com/benjamine/jsondiffpatch |
| MongoDB Node.js driver | Optional MongoDB source-of-truth adapter | Apache-2.0 | https://github.com/mongodb/node-mongodb-native |
| node-postgres (`pg`) | Optional PostgreSQL source-of-truth adapter | MIT | https://github.com/brianc/node-postgres |
| Playwright | Chromium automation and browser evidence | Apache-2.0 | https://github.com/microsoft/playwright |
| rrweb | Masked local DOM/session event recording | MIT | https://github.com/rrweb-io/rrweb |
| Zod | Runtime validation for policies, ledgers, and benchmark contracts | MIT | https://github.com/colinhacks/zod |

`better-sqlite3`, `mongodb`, and `pg` are optional dependencies loaded through their public APIs only when their adapters are configured. No third-party adapter source is copied into this repository.
