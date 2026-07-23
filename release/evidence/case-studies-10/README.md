# 10 real-project browser qualifications

RealDone was run against ten pinned MIT projects in their real local runtimes. Each clean control was scanned first. The included patch then added one visible `Create qualification record` button with no product behavior; Quiver also stops host-level pointer propagation so its canvas handlers cannot create an unrelated effect. Every injected button was discovered in Chromium and classified `NO_EFFECT` with detector `RD002` in a `VALID` environment.

| Project | Clean control | Injected fault |
| --- | --- | --- |
| Flatnotes | 21 verified, 2 uncertain, 1 skipped | `NO_EFFECT / RD002` |
| Linkding | 47 verified, 5 uncertain, 12 skipped | `NO_EFFECT / RD002` |
| Flame | 4 verified, 1 uncertain, 1 skipped | `NO_EFFECT / RD002` |
| TakeNote | 9 verified, 4 uncertain, 3 skipped | `NO_EFFECT / RD002` |
| Grimoire | 31 verified, 2 uncertain, 7 skipped | `NO_EFFECT / RD002` |
| Dashy | 3 verified, 36 safety skips | `NO_EFFECT / RD002` |
| JSPaint | 6 verified, 1 uncertain, 1 skipped | `NO_EFFECT / RD002` |
| 2048 | 1 uncertain, 4 navigation skips | `NO_EFFECT / RD002` |
| Flowy | upstream Search remains `BROKEN / RD002,RD007`; 3 navigation skips | `NO_EFFECT / RD002` |
| Quiver | 13 verified, 2 uncertain, 1 skipped | `NO_EFFECT / RD002` |

`manifest.json` pins repository commits, license hashes, exact run IDs, and SHA-256 hashes of the raw local `scan.json` and `report.html` artifacts. Raw multi-megabyte browser artifacts are intentionally excluded from Git; the source mutations are preserved in `patches/` and are reproducible against the pinned commits. No external project code is shipped in RealDone.

Apply a patch from its pinned checkout with `git apply --unidiff-zero --ignore-space-change <patch>`; the flags keep the minimal HTML insertion reproducible across upstream CRLF/LF files.

Limitations: these runs qualify Chromium behavior on Windows and detector regression coverage. They do not replace the hosted cross-platform release gates or prove every action in every project. `UNCERTAIN` and safety-policy `SKIPPED` results are preserved rather than promoted to passing claims.
