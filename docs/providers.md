# Providers & setup

bonfire runs against a local model. Two providers are supported:

- **Ollama** — easiest on macOS / Linux. One-liner install, tool calling works out of the box.
- **llama.cpp** (`llama-server`) — best for Windows, or when you want direct control over GGUF quants, offload, and the chat template.

This doc walks through both on both operating systems.

---

## 1. Ollama

### macOS

```bash
brew install ollama                  # or download from https://ollama.com/download
ollama pull qwen2.5-coder:latest
```

Start the daemon (one of):
- Launch the **Ollama** menu-bar app from `/Applications`, or
- `ollama serve` in its own terminal.

Verify it's up: `curl http://localhost:11434/api/tags`

Run bonfire — Ollama is the default provider, so no env vars needed:

```bash
cd path/to/bonfire
npm install
npm start
```

TUI header should read `ollama · qwen2.5-coder:latest`.

To pick a different model:

```bash
BONFIRE_MODEL=qwen3-coder:30b npm start
```

Or pin it in `bonfire.config.json`:

```json
{
  "provider": {
    "active": "ollama",
    "ollama": {
      "baseURL": "http://localhost:11434/api",
      "model": "qwen3-coder:30b"
    }
  }
}
```

### Windows

Install from https://ollama.com/download (MSI installer). Ollama runs as a background service on `http://localhost:11434`.

```powershell
ollama pull qwen2.5-coder:latest
cd path\to\bonfire
npm install
npm start
```

To switch model:

```powershell
$env:BONFIRE_MODEL = "qwen3-coder:30b"
npm start
```

### Remote Ollama host

```bash
OLLAMA_BASE_URL=http://192.168.1.50:11434/api npm start
```

Note the `/api` suffix — bonfire talks to Ollama's native API, not its OpenAI-compat shim.

### Models that tool-call reliably on Ollama

`qwen2.5-coder`, `qwen3-coder`, `qwen2.5`, `llama3.1`, `llama3.3`, `hermes3`, `llama3-groq-tool-use`, `mistral-nemo`. Base models and most Gemma variants will hallucinate tool syntax — avoid.

---

## 2. llama.cpp (`llama-server`)

bonfire treats llama.cpp as an OpenAI-compatible endpoint (the same pattern opencode uses): it posts standard `/v1/chat/completions` requests with `tools` / `tool_calls` to `llama-server`. You point bonfire at the server URL; llama-server loads the GGUF you hand it with `-m`.

### Windows

#### a. Install `llama-server`

Download a prebuilt binary from https://github.com/ggml-org/llama.cpp/releases (pick the variant matching your GPU):

| GPU | Release asset |
| --- | --- |
| NVIDIA | `llama-b*-bin-win-cuda-*.zip` |
| AMD / Intel / fallback | `llama-b*-bin-win-vulkan-*.zip` |
| CPU only | `llama-b*-bin-win-avx2-*.zip` |

Unzip (e.g. `C:\tools\llama.cpp`). Download a GGUF model — a solid Windows pick for 32 GB RAM + 6 GB VRAM is `qwen3-coder-30b-a3b-instruct-Q4_K_M.gguf` (MoE, fast, reliable tool calling). Save it anywhere, e.g. `C:\models\`.

#### b. Start the server

In **PowerShell**:

```powershell
cd C:\tools\llama.cpp
.\llama-server.exe `
  -m C:\models\qwen3-coder-30b-a3b-instruct-Q4_K_M.gguf `
  -c 32768 `
  --host 127.0.0.1 --port 8080 `
  --jinja `
  -ngl 28
```

Flag reference:

| Flag | Purpose |
| --- | --- |
| `--jinja` | **Required for tool calling.** Enables the model's built-in chat template so llama-server parses `tool_calls` instead of returning them as plain text. |
| `-ngl N` | Number of transformer layers to offload to GPU. Start low (20–28) with 6 GB VRAM, bump until it fits. |
| `-c N` | Context size. Bigger = more VRAM/RAM used by the KV cache. |
| `--model` / `-m` | Path to GGUF model file. |
| `--alias` | Cosmetic alias for the model (what bonfire displays). |
| `--host` / `--port` | Bind address. Keep `127.0.0.1` for local-only. |
| `--temp N` | Temperature for sampling (0–2, default 0.8). Lower = more deterministic. |
| `--top-p N` | Nucleus sampling threshold (0–1). Higher = more diverse. |
| `--top-k N` | Keep only top-K most likely next tokens. |
| `--min-p N` | Minimum probability threshold. |
| `--presence-penalty N` | Penalty for repeating tokens. |

**Example configuration (Qwen3.6-35B, MoE, tuned for code):**

```powershell
.\llama-server.exe `
  --model C:\models\Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf `
  --alias "unsloth/Qwen3.6-35B-A3B" `
  -c 32768 `
  --jinja `
  --temp 0.6 `
  --top-p 0.95 `
  --top-k 20 `
  --min-p 0.00 `
  --presence-penalty 0.0 `
  --port 8080
```

Verify: open `http://127.0.0.1:8080` in a browser — you'll see llama.cpp's web UI.

#### c. Run bonfire against it

In a **second** PowerShell window:

```powershell
cd path\to\bonfire
npm install

$env:BONFIRE_PROVIDER     = "llama.cpp"
$env:BONFIRE_MODEL        = "qwen3-coder"              # cosmetic — llama-server ignores the id
$env:LLAMACPP_BASE_URL = "http://127.0.0.1:8080/v1" # optional; this is the default
npm start
```

Or skip env vars by using `bonfire.config.json`:

```json
{
  "provider": {
    "active": "llama.cpp",
    "llama.cpp": {
      "baseURL": "http://127.0.0.1:8080/v1",
      "model": "qwen3-coder"
    }
  }
}
```

TUI header should read `llama.cpp · qwen3-coder`.

Persist the provider choice across shells: `setx BONFIRE_PROVIDER llama.cpp` (takes effect in *new* shells).

### macOS

#### a. Install `llama-server`

Easiest route:

```bash
brew install llama.cpp
```

Or build with Metal from source for the latest features:

```bash
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build -DGGML_METAL=ON
cmake --build build --config Release -j
# binary lands at build/bin/llama-server
```

Download a GGUF model (e.g. via `huggingface-cli download` or a browser) and save it somewhere like `~/models/`.

#### b. Start the server

```bash
llama-server \
  -m ~/models/qwen3-coder-30b-a3b-instruct-Q4_K_M.gguf \
  -c 32768 \
  --host 127.0.0.1 --port 8080 \
  --jinja \
  -ngl 99
```

On Apple Silicon, `-ngl 99` offloads everything to the Metal GPU (unified memory makes this essentially free). Drop it if you're on an Intel Mac without a dGPU.

#### c. Run bonfire against it

```bash
cd path/to/bonfire
npm install

export BONFIRE_PROVIDER=llama.cpp
export BONFIRE_MODEL=qwen3-coder
npm start
```

Or use `bonfire.config.json` as shown above.

---

## Provider selection precedence

When bonfire starts it picks the provider in this order (first match wins):

1. `BONFIRE_PROVIDER` environment variable (`ollama` | `llama.cpp`)
2. `provider.active` in `bonfire.config.json`
3. Default: `ollama`

Model id follows the same idea:

1. `BONFIRE_MODEL` env var
2. `provider.<id>.model` in config
3. Provider-specific default (`qwen2.5-coder:latest` for Ollama, `local-model` for llama.cpp)

---

## Hardware sizing (llama.cpp)

Rules of thumb for GGUF + `llama-server`:

| RAM / VRAM | Recommended model | Quant |
| --- | --- | --- |
| 16 GB RAM, any GPU | Qwen2.5-Coder 7B / Llama 3.1 8B | Q4_K_M (~5 GB) |
| 32 GB RAM, 6 GB VRAM | **Qwen3-Coder 30B-A3B** (MoE) | Q4_K_M (~18 GB) |
| 32 GB RAM, 12 GB+ VRAM | Qwen2.5-Coder 32B dense | Q4_K_M (~19 GB) |
| 64 GB RAM, 24 GB+ VRAM | Qwen3-Coder 30B-A3B | Q6_K or Q8_0 |

The MoE model (`30B-A3B` = 30B total, 3B active per token) is the sweet spot for modest hardware: small active footprint means 10–20 tok/s even with mostly-CPU inference.

---

## Debugging tool calling

If the model *describes* editing a file but no `● write_file(...)` line appears in the TUI, run with:

```bash
BONFIRE_DEBUG=1 npm start          # macOS / Linux
```
```powershell
$env:BONFIRE_DEBUG="1"; npm start  # Windows
```

Common causes:

| Symptom | Cause |
| --- | --- |
| Model outputs XML-ish tool syntax as plain text | llama-server missing `--jinja`, or GGUF lacks a chat template — pass `--chat-template-file <path>` |
| `404` from llama-server | Wrong `baseURL` — it must end in `/v1` |
| `model ... not found` from Ollama | `BONFIRE_MODEL` tag not pulled — run `ollama list` to check |
| Tool calls arrive but never execute | `BONFIRE_DISABLE_BUILTINS=1` is set and no MCP server provides that tool |
| Ink raw-mode crash on Windows | Running under Git Bash / MSYS — use Windows Terminal or wrap with `winpty` |

---

## See also

- [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases)
- [llama.cpp server docs](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) — full flag list for `llama-server`
- [Ollama model library](https://ollama.com/library)
- [Qwen3-Coder on Hugging Face](https://huggingface.co/Qwen) — GGUF quants

## License

MIT
