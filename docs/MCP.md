# MCP integration

RealDone runs without AI. The local MCP server is an additional entry point that lets Codex, Claude Code, or another MCP client call the same core used by the full CLI.

```text
Developer / CI -> RealDone CLI -> RealDone core
Coding agent   -> RealDone MCP -> RealDone core
```

## Tools

| Tool | Purpose |
| --- | --- |
| `scan` | Safe browser scan; with no URL it discovers and manages the current project |
| `record` | Bounded headed recording while a user demonstrates a flow |
| `verify` | Deterministically verify one behavior contract |
| `baseline` | Capture a verified pre-change baseline |
| `verify_change` | Verify affected or all contracts after a code change |
| `replay` | Freshly reproduce a finding |
| `get_report` | Read a redacted report summary and finding list |

MCP browser-action tools are disabled unless the user starts that project session with `--allow-project-actions` after confirming disposable local/staging data. This one-time session consent covers the possibility of opaque app handlers, but never enables classified destructive actions, classified external effects, production providers, or paths outside the configured project root. Replay discards any historical side-effect grants stored in a reproduction, and MCP exposes no way for an agent to re-enable them. The agent's message is operational output, not verification evidence.

When `scan` is called without a URL, MCP discovers, starts, health-checks, scans, and stops the configured project. With an explicit URL, the caller remains responsible for that runtime.

`scan` also accepts project-relative `sqlite`, `databaseConfigs`, `providerConfigs`, and `sourceSnapshotLimit` inputs. Database inputs attach read-only, value-free source snapshots and diffs. Provider configs may link an explicitly matched action/request to bounded read-only Level 6 confirmation. `replay` accepts the same project-relative `providerConfigs`; a provider-backed reproduction stays `REPLAY_UNCERTAIN` unless the fresh action causally confirms every recorded provider name/kind/resource/operation/state requirement. Neither path exposes source rows, provider references, or credentials to the agent, and project-root confinement applies to replay configs too.

## Use the source build today

Build RealDone, then use absolute paths for the RealDone checkout and target project.

Codex:

```bash
codex mcp add realdone -- node /absolute/path/to/RealDone/dist/cli.js mcp --project /absolute/path/to/my-app --allow-project-actions
codex mcp list
```

Interactive Codex can ask for MCP approval. For an explicitly authorized non-interactive project session, set only this server's `default_tools_approval_mode = "approve"` in Codex config (or use the equivalent one-run `-c` override). `--ask-for-approval never` auto-rejects a prompt-required MCP call; it does not grant approval.

Claude Code:

```bash
claude mcp add --transport stdio --scope project realdone -- node /absolute/path/to/RealDone/dist/cli.js mcp --project /absolute/path/to/my-app --allow-project-actions
claude mcp get realdone
```

The local server uses stdio and writes protocol messages only to stdout. Operational logs go to stderr.

## npm package

The intended one-command MCP configuration is:

```bash
codex mcp add realdone -- npx -y realdone mcp --allow-project-actions
claude mcp add --transport stdio --scope project realdone -- npx -y realdone mcp --allow-project-actions
```

The package is published at [`realdone`](https://www.npmjs.com/package/realdone). Run the server in the web project's root, or pass `--project`. Claude Code's `CLAUDE_PROJECT_DIR` is also honored automatically.

## Agent workflow

For an existing contract suite:

```text
1. Agent calls baseline before editing.
2. Agent changes the project.
3. Agent calls verify_change with the changed file list.
4. RealDone verifies affected behavior in a real browser.
5. Agent fixes regressions and calls verify_change again.
```

For a quick exploratory check, the agent can call `scan` directly. Important flows should still become versioned behavior contracts.

## Qualification status

- Real stdio protocol, installed-package startup, tool discovery, no-URL managed scan, browser evidence, and runtime cleanup are executable smoke gates.
- Authenticated Codex CLI `0.143.0` called `realdone.scan` through MCP against the pinned Conduit application. RealDone run `20260722T182305Z-c8ae` returned `VALID`, four `VERIFIED`, one policy `SKIPPED`, and zero defect verdicts.
- The first non-interactive attempt correctly failed closed because Codex's MCP approval mode required a prompt. The qualified run used the documented per-server `default_tools_approval_mode="approve"` only after explicit user/project authorization; `--ask-for-approval never` alone auto-rejects prompt-required MCP calls.
- Claude Code was not used because this release environment has no Claude account. Claude and generic clients remain optional consumers of the same MCP protocol and core rather than separate verification engines.

The Codex message is not evidence. The RealDone scan/report created by the MCP call is the qualification evidence.
