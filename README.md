<div align="center">


# bonfire
<img src="./docs/banner.jpg" alt="bonfire — a free, local-first AI coding assistant for the terminal" width="820" />

**A terminal coding assistant that runs on your laptop, not someone else's datacenter.**

Free · Local-first · No API keys · Bring your own model

<!-- Replace with real badges once published -->
<!--
[![npm](https://img.shields.io/npm/v/bonfire.svg)](https://www.npmjs.com/package/bonfire)
[![license](https://img.shields.io/github/license/your-org/bonfire.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-green.svg)](#install)
-->

<!-- Replace with a real demo GIF -->
<!-- ![bonfire demo](./docs/demo.gif) -->

</div>

---

## Why bonfire

- **Your code stays on your machine.** No cloud round-trips, no audit logs on someone's dashboard.
- **Free.** Runs against any local model via [Ollama](https://ollama.com) — no subscriptions, no token quotas.
- **Honest about what it's doing.** Streams every token, previews diffs before writing, tracks token usage per turn.
- **Small and hackable.** ~500 lines of TypeScript. Read it all in one sitting.

## Features

- **Streaming** — model text and tool arguments stream live as they're generated.
- **Diff-preview approvals** — every `write_file` / `edit_file` shows a coloured unified diff and waits for `y`/`n` before touching disk.
- **Modified-files panel** — live tally of everything the agent has written or edited this session.
- **Token counter** — per-turn and cumulative input/output counts, displayed above the prompt.
- **Multi-directory** — `/add-dir` to grant access to sibling projects mid-session.
- **Flicker-free TUI** — committed transcript is append-only; the spinner never repaints history.
- **MCP-native** — any stdio Model Context Protocol server plugs in via `bonfire.config.json`.
- **Platform-aware** — the system prompt adapts to Windows / macOS / Linux so the `shell` tool gets the right commands.
- **TTY-safe startup** — friendly error with remediation instead of the usual raw-mode crash.

## Install

Requires **Node 20+** and a local model server. Two supported:

- [Ollama](https://ollama.com/download) — recommended on macOS / Linux.
- [llama.cpp `llama-server`](https://github.com/ggml-org/llama.cpp) — recommended on Windows, or when you want direct control over GGUF quants.

```bash
npm install -g bonfire
ollama pull qwen2.5-coder:latest          # if using Ollama
```

Or run from a clone:

```bash
git clone https://github.com/your-org/bonfire
cd bonfire
npm install
npm start
```

> **Platform-specific setup (Windows + macOS, both providers):** see [`docs/providers.md`](./docs/providers.md).

## Quick start

```bash
cd your-project
bonfire
```

Try these first prompts:

- `list the files in src`
- `read src/index.ts and summarize what the main function does`
- `add a blank line at the end of README.md`  ← triggers the diff-approval flow

## In-session commands

| Command | Effect |
| --- | --- |
| `/add-dir <path>` | Add a directory to the filesystem allowlist |
| `/dirs` | Show all currently-allowed directories |
| `/exit`, `/quit`, `esc` | Leave |

While a diff is pending, `y` / `enter` approves and `n` / `esc` rejects.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `BONFIRE_PROVIDER` | `ollama` | Active provider — `ollama` or `llama.cpp` |
| `BONFIRE_MODEL` | provider-specific | Model id (Ollama tag, or cosmetic label for llama.cpp) |
| `OLLAMA_BASE_URL` | `http://localhost:11434/api` | Ollama host URL |
| `LLAMACPP_BASE_URL` | `http://127.0.0.1:8080/v1` | `llama-server` OpenAI-compatible endpoint |
| `LLAMACPP_API_KEY` | — | Optional bearer token if `llama-server` is behind an auth proxy |
| `BONFIRE_DEBUG` | — | `1` to log every HTTP request / status code |
| `BONFIRE_DISABLE_BUILTINS` | — | `1` to run with only MCP tools (no built-ins) |

Provider / model can also be pinned in `bonfire.config.json` — see [`docs/providers.md`](./docs/providers.md).

## Built-in tools

| Tool | What it does |
| --- | --- |
| `read_file` | Read a file within the allowlist |
| `write_file` | Create/overwrite a file — **diff-approval gated** |
| `edit_file` | Exact-string replace — **diff-approval gated** |
| `list_dir` | List directory contents |
| `shell` | Run a shell command (`/bin/sh` on Unix, `cmd.exe` on Windows) |

All filesystem tools respect the directory allowlist; use `/add-dir` to extend it.

## MCP servers

Drop a `bonfire.config.json` next to where you launch:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx" }
    }
  }
}
```

Any stdio MCP server works. Tools are namespaced as `<server>__<tool>` to avoid collisions with built-ins. A failing server doesn't block startup of the others.

## Models that work

Any model trained for tool calling:

| Model | Tool calling |
| --- | --- |
| `qwen2.5-coder` / `qwen3-coder` | yes |
| `qwen2.5` | yes |
| `hermes3:8b` | yes |
| `llama3.1` / `llama3.3` | yes |
| `llama3-groq-tool-use:8b` | yes |
| `deepseek-coder-v2` | varies by version |
| `gemma3` / `gemma2` | no (not tool-tuned) |

For llama.cpp, tool calling requires starting `llama-server` with `--jinja`. See [`docs/providers.md`](./docs/providers.md#debugging-tool-calling).

## Platform notes

- **Windows:** run from **Windows Terminal** or **PowerShell**. Git Bash / MSYS users need `winpty bonfire` because Node can't attach to MSYS's non-TTY stdin.
- **macOS / Linux:** works in any modern terminal (iTerm2, Alacritty, Terminal.app, gnome-terminal, kitty, etc.).
- **Full platform + provider setup:** [`docs/providers.md`](./docs/providers.md).

## Roadmap

- [ ] Editable diffs (`y` / `n` / `e`, where `e` opens the patch in `$EDITOR`)
- [ ] Side-by-side model race mode
- [ ] Local RAG over the project via a small embedding model
- [ ] Session replay — re-run a conversation against a different model
- [ ] First-run benchmark panel (tokens/sec per installed model)
- [ ] Per-project config (`.bonfire.json`)
- [ ] Auto-verify loop — run typecheck/tests after each edit, feed failures back

## Contributing

Issues and small PRs welcome. The codebase is intentionally minimal; favour clarity over cleverness.

```
src/
  config.ts         # bonfire.config.json loader (shared)
  agent/
    index.ts        # runAgent, initMcp, listTools
    provider.ts     # lazy provider, debug fetch with header redaction
    stream.ts       # typed normalizer for AI SDK fullStream events
    system-prompt.ts# 3-layer prompt: built-in + ~/.bonfire + .bonfire/system.md
  tools/
    safe-path.ts    # realpath-aware allowlist (closes symlink escapes)
    approval.ts     # tri-state yes/no/always handler
    shell-policy.ts # hardcoded deny-list + per-config allow/deny patterns
    file-tools.ts, shell-tool.ts, navigate-tool.ts
  mcp/
    index.ts, stdio.ts, http.ts, windows.ts
  session/
    index.ts, storage.ts, meta.ts
  codemap/
    walk.ts, summarize.ts, store.ts, index.ts, ignore.ts, types.ts
  providers/
    index.ts, ollama.ts, llamacpp.ts, types.ts
  cli/
    bin.tsx         # entry: TTY check, MCP boot, render <App/>, signals
    App.tsx         # layout-only composition
    components/     # Header, Transcript, ToolLine, ResultLine, DiffPreview,
                    # ModifiedFilesPanel, UsageBar, ApprovalPrompt, PromptBar,
                    # MultilineInput, CommandSuggestions, ToolsPane
    hooks/          # useAgentStream, useApproval, useProvider, useThinkingPhrase
    commands/       # slash-command registry: codemap, sessions, dirs, help, exit
```

## License

MIT
