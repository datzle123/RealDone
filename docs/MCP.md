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

MCP never enables destructive actions, external effects, production providers, or paths outside the configured project root. The agent's message is operational output, not verification evidence.

When `scan` is called without a URL, MCP discovers, starts, health-checks, scans, and stops the configured project. With an explicit URL, the caller remains responsible for that runtime.

`scan` also accepts project-relative `sqlite`, `databaseConfigs`, and `sourceSnapshotLimit` inputs. These attach read-only, value-free source snapshots and diffs to mutation evidence without exposing database rows to the agent.

## Use the source build today

Build RealDone, then use absolute paths for the RealDone checkout and target project.

Codex:

```bash
codex mcp add realdone -- node /absolute/path/to/RealDone/dist/cli.js mcp --project /absolute/path/to/my-app
codex mcp list
```

Claude Code:

```bash
claude mcp add --transport stdio --scope project realdone -- node /absolute/path/to/RealDone/dist/cli.js mcp --project /absolute/path/to/my-app
claude mcp get realdone
```

The local server uses stdio and writes protocol messages only to stdout. Operational logs go to stderr.

## After the npm release

The intended one-command MCP configuration is:

```bash
codex mcp add realdone -- npx -y realdone mcp
claude mcp add --transport stdio --scope project realdone -- npx -y realdone mcp
```

Do not use these npm commands until the package is published. Run the server in the web project's root, or pass `--project`. Claude Code's `CLAUDE_PROJECT_DIR` is also honored automatically.

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
- Codex CLI `0.143.0` recognizes the source-build server configuration, but the latest local agent attempt stopped before tool execution because its configured API credential returned HTTP 401.
- Claude Code is not installed or authenticated in the current release environment.

Therefore real Codex/Claude agent-driven qualification remains `PARTIAL`; protocol smoke is not substituted for an authenticated agent cycle.
