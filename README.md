# nano-code

Minimal Claude Code-style agentic coding TUI. Built on Ink + Vercel AI SDK + Ollama.
~300 lines. Works with any local tool-calling model.

## Install

```bash
cd nano-code
npm install
```

## Run

Default (Ollama on localhost, model `qwen2.5-coder:latest`):
```bash
npm start
```

Custom model / remote Ollama (e.g. WSL → Windows host):
```bash
export OLLAMA_BASE_URL=http://172.28.112.1:11434/api
export NANO_MODEL=qwen2.5-coder:latest
npm start
```

## Tools the agent can call

Built-in:
- `read_file` — read a file
- `write_file` — create / overwrite a file
- `edit_file` — exact-string replace
- `list_dir` — list directory contents
- `bash` — run a shell command

All constrained to the current working directory.

## MCP servers

Create `nano-code.config.json` in the directory where you run `npm start`:

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

Any stdio MCP server works. Tools are exposed to the model as `<server>__<tool>`,
so `filesystem`'s `read_file` becomes `filesystem__read_file` (no collision with
the built-in `read_file`). Startup logs show what loaded; failures to start one
server don't block the others.

See `nano-code.config.example.json` for more examples.

## Expected model

Needs a model trained for tool calling:
- `qwen2.5-coder:latest` ✅
- `hermes3:8b` ✅
- `llama3-groq-tool-use:8b` ✅
- `gemma3` / `gemma4` ❌ (not tool-tuned)

## Commands

- `/exit` or `/quit` — leave
- `esc` — leave

## Known limits

- No session persistence between runs.
- No streaming tool arguments (waits for full tool call).
- No diff preview before write/edit — tools execute immediately.
- 10-step agentic loop cap.
