# Coding-agent verification

RealDone can place an independent behavioral gate around a coding-agent run:

```text
Green behavior baseline
→ coding agent
→ rebuild
→ Git changed-file attribution
→ affected RealDone flows
→ regression report or evidence-based follow-up
```

The agent's final message is never verification evidence. A run passes only when the baseline was green, the agent process completed, the rebuild succeeded, and affected behavior contracts still pass in a real browser.

## Codex preset

```bash
realdone run codex \
  --task-file task.md \
  --contracts .realdone/flows \
  --build-command pnpm --build-arg build
```

The preset uses Codex non-interactive execution with an ephemeral session, a workspace-write sandbox, no unavailable approval prompts, and JSONL operational output. It does not use the deprecated `--full-auto` compatibility flag. Authentication is inherited from the installed Codex CLI; RealDone does not copy credentials into its report.

See the official [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) documentation for authentication and sandbox policy.

## Claude Code preset

```bash
realdone run claude \
  --task "Add persistent customer deletion" \
  --contracts .realdone/flows \
  --build-command pnpm --build-arg build \
  --agent-max-turns 50
```

The preset uses print mode, JSON output, `acceptEdits` permission mode, and a bounded turn count. Authentication and any extra tool policy remain owned by the installed Claude Code configuration. See Anthropic's official [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage).

## Generic command adapter

The generic preset accepts an executable and repeated argument values. The task is appended as one final argument and is never interpolated through a shell.

```bash
realdone run generic \
  --agent-command my-agent \
  --agent-arg run --agent-arg --non-interactive \
  --task-file task.md \
  --contracts .realdone/flows
```

Use repeated `--agent-arg` and `--build-arg` flags so each argument remains structurally separate. `cross-spawn` provides consistent executable resolution for Windows, macOS, and Linux while `shell` remains disabled.

## Pipeline contract

1. RealDone requires a Git repository with at least one commit and refuses a dirty worktree unless `--allow-dirty` is explicit.
2. Every supplied behavior contract is hashed and verified before the agent runs. A failing baseline stops the pipeline. The baseline is sealed and restored if the agent modifies it.
3. The agent runs with a default 30-minute timeout. Stdout and stderr are bounded, redacted, and written as local operational logs.
4. The rebuild command runs independently with a default five-minute timeout. It defaults to `pnpm build`.
5. After the independent rebuild completes, RealDone captures the resulting Git commit and uncommitted paths, then selects affected/critical flows from that final post-build change set. Build-created product files are therefore attributed to the run. If no contract can be mapped safely to non-empty changed files, RealDone fails closed by running the full manifest instead of accepting a zero-flow pass. Behavior-contract changes force a full run and fail the integrity gate unless `--allow-contract-changes` is explicit.
6. A passing run writes `agent-verification.json`. A failing run additionally writes `follow-up.md` using only build diagnostics and failed RealDone assertions.

Output lives under `.realdone/agent-runs/<run-id>/` by default:

```text
baseline.json
baseline-runs/
agent.stdout.log
agent.stderr.log
build.stdout.log
build.stderr.log
regression/
agent-verification.json
follow-up.md        # failures only
```

Known environment secret values, provider-key shapes, bearer tokens, and database URLs are redacted. Treat the directory as sensitive anyway because an application or tool can emit private data in an unexpected format.

## Current qualification evidence

The repository-bound qualification is documented in [`release/evidence/ai-agent-cycle.json`](https://github.com/datzle123/RealDone/blob/main/release/evidence/ai-agent-cycle.json). Authenticated Codex Desktop `0.143.0` session `019f8b5d-c0da-7f72-8a98-01cf58fd1d18` established green baseline verification `20260722T194657Z-ac97`, selected one unchanged contract with one RD901 regression in run `20260722T195413Z-217b`, repaired the application, and selected the same contract with zero regressions in run `20260722T195754Z-a9bd`. The release validator parses SHA-256-bound session, baseline, failed-verification, regression and repair artifacts; it does not trust the agent's final message.

This evidence supports the `IMPLEMENTED` coding-agent row in [`PRODUCT_STATUS.md`](PRODUCT_STATUS.md). Hosted run [`29958126604`](https://github.com/datzle123/RealDone/actions/runs/29958126604) aggregated it across Windows/macOS/Linux, passed all 15 gates, and produced verified signed GitHub provenance, closing Phase G and §32.

## Authenticated and Level 6 flows

The `run` command accepts the same storage-state, browser, safety, and PostgreSQL options as `verify`:

```bash
realdone run codex \
  --task-file task.md \
  --contracts .realdone/flows \
  --storage-state .realdone/auth/admin.json \
  --postgres-config .realdone/postgres.json
```

Keep the application running while RealDone captures the baseline and verifies after rebuild. If your stack does not hot-reload the rebuilt application, restart it as part of a project-specific build wrapper executable before the verification stage.
