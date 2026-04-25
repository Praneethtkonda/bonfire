# Codemap Improvements

> **Status:** design — not yet implemented
> **Owner:** TBD
> **Last updated:** 2026-04-25

This is the engineering plan for taking bonfire's codemap from *"works but slow on Windows"* to *"fast on every platform, structurally accurate, and graph-queryable when you need it."*

The plan is phased. Each phase ships independently and is measurable on its own. **Do not skip ahead** — phase 1 alone gets us most of the win and unblocks the higher tiers.

---

## Goals

| Metric | Today (baseline) | Phase 1 target | Phase 2 target |
| --- | --- | --- | --- |
| 500-file TS repo, M2 Mac | ~4 min | ~30 sec | ~15 sec |
| 500-file TS repo, Windows 32 GB | ~12 min | ~90 sec | ~45 sec |
| 5000-file monorepo, M2 | ~40 min | ~5 min | ~90 sec |
| Summary accuracy on config files | poor (LLM hallucinates) | poor (still LLM) | high (format-specific) |
| Cross-file edge queries (callers, importers) | impossible | impossible | possible |

Numbers are estimates. We commit to **measuring and publishing real numbers** as part of each phase.

## Non-goals

Things we will *not* do, and why:

- **No vector DB / embeddings.** Breaks the "single CLI, no daemons" promise. Multiple production assistants have shown that for *navigation* (vs. semantic recall) a tree-of-summaries beats embeddings on quality and is cheaper to build.
- **No knowledge-graph extraction (entities + relationships).** Microsoft GraphRAG-style pipelines are great for "explain how feature X works across the codebase" but cost hours and dollars to build. Out of scope until we have a concrete demand we can't answer with cheaper means.
- **No language-server / LSIF / SCIP indexer.** That's Sourcegraph's territory. We can ship 80% of the value with tree-sitter and 5% of the implementation cost.
- **No graph database (KuzuDB / Neo4j / Cozo) in v1.** SQLite with proper indexes handles every realistic codemap-scale query. We revisit only after measuring SQLite hitting limits.

---

## Where time goes today

Profile of the current `buildSummaries()` on a 500-file TypeScript repo:

| Phase | % of wall-clock | What's doing the work |
| --- | --- | --- |
| LLM inference (per-file summary call) | **~94%** | Your model server (Ollama / llama.cpp). Sequential. |
| File I/O + AV scanning | ~3% | OS. Worse on Windows due to Defender real-time scanning. |
| JSON parse / serialize | <1% | Negligible. |
| Repo walk + regex skeleton | ~2% | Already fast. |

**Headline:** the bottleneck is LLM round-trips. Everything else is rounding error. Optimisations must reduce *how many model calls we make* and *how much each call has to chew on*.

---

## Phase 1 — Stop wasting LLM calls

Goal: hit the targets above without changing the storage format. ~1 day of focused work.

### 1.1 Batched summarisation

Today: 1 file → 1 LLM call. With concurrency 3, that's max 3 in flight at once.

Plan: pack **N files (default 8) into a single prompt** and ask the model for a JSON array of summaries. Run **M batches concurrently (default 4–8).**

Rough numbers per batch on a 7B model:
- Input ≈ 6 K tokens (8 × 750 token avg)
- Output ≈ 400 tokens
- Wall-clock ≈ 13 s per batch

```
500 files / 8 per batch = 63 batches
63 / 8 concurrency      = 8 waves
8 × 13 s                = ~100 s
```

vs. today's ~250 s on the same hardware. **2.5× from batching alone**, and that's before we touch the model itself.

**Risks / mitigations:**
- One file's content trips the model → whole batch fails. Mitigate with retry-as-singletons after a batch error.
- Schema reliability for arrays drops slightly past N=10. Cap default at 8.
- Model output isn't valid JSON. Use the AI SDK's structured-output mode, fall back to a tolerant repair pass before retry.

### 1.2 Separate, smaller model for summaries

Today: same model handles chat *and* per-file summaries. A 7B chat model summarising a 200-line file is wildly overprovisioned.

Plan: new config block.

```json
{
  "codemap": {
    "model": "qwen3:1.7b",
    "concurrency": 8,
    "batchSize": 8
  }
}
```

If `codemap.model` is not set, fall back to the chat model. Local 1.7–3B coder models summarise files within ~3% of what a 7B does, at 3–5× the throughput.

### 1.3 Aggressive default excludes

Add to `src/codemap/ignore.ts` defaults:

```
.next/   .nuxt/   .svelte-kit/   .turbo/   .parcel-cache/
dist/    build/   out/           target/   coverage/
.venv/   .tox/    __pycache__/   *.pyc
.gradle/ .m2/     .pytest_cache/
.angular/ vendor/ third_party/
```

These dirs contribute zero useful summaries today and they dominate file-count in many real repos. Aggressively skipping them is a 30–50% file-count reduction on typical Node monorepos and Python projects.

### 1.4 Windows Defender exclusion (documentation, not code)

Add to README a short Windows section:

> **Tip for Windows users:** add `.bonfire\` to Windows Defender's excluded paths. Real-time scanning every file we open dominates I/O time on NTFS and triples codemap build time on a 32 GB box. One-time setup, halves wall-clock.

### 1.5 Resumable progress

Today: if `/codemap build` is interrupted at file 200/500, all 200 summaries are lost. Plan: flush summaries to disk after every batch completes. Resuming reads the existing entries and skips them.

This is essentially free given batching — we're already writing to `.bonfire/codemap.json` once at the end; just write incrementally.

### Deliverables for phase 1

- Config block: `codemap.{model,concurrency,batchSize}`
- Refactor `summarize.ts` to take batches
- Retry-as-singletons fallback
- Per-batch incremental persist
- Expanded `ignore.ts` default list
- README Windows-Defender note
- A single benchmark script (`scripts/bench-codemap.ts`) so we publish honest before/after numbers

---

## Phase 2 — A tiered extraction pipeline

Phase 1 is "send fewer, smaller calls to the LLM." Phase 2 is **"don't call the LLM at all when something cheaper works."**

### 2.1 The pipeline shape

For every file, run extractors in order. The first one that returns a non-empty summary wins.

```
┌────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Skip?    │ →   │ Format-specific  │ →   │   Tree-sitter    │ →   │     LLM          │
│ generated, │     │  package.json,   │     │  decls, exports, │     │  (last resort,   │
│  vendored  │     │  Dockerfile, etc │     │  imports, types  │     │   batched)       │
└────────────┘     └──────────────────┘     └──────────────────┘     └──────────────────┘
   ~10% files          ~15% files               ~60% files            ~15% files
```

Realistic distribution on a typical web/services repo. Polyglot or doc-heavy repos shift toward tier 3.

### 2.2 Tier 0 — skip rules

Pure ignore patterns, applied before any extractor runs. Subset of `ignore.ts` extended for files that *look like code* but are useless:

- `*.min.{js,css}`, `*.map`, `*.d.ts.map`
- Lockfiles: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `poetry.lock`, `Pipfile.lock`, `composer.lock`, `Gemfile.lock`
- Generated: `*.pb.go`, `*.pb.ts`, `*.gen.{ts,go}`, `*_pb2.py`
- Snapshots / fixtures: `__snapshots__/**`, `**/fixtures/*.json` (if > 100 KB)
- Vendored: `vendor/**`, `third_party/**`, `node_modules/**` (already excluded)

These get a placeholder summary like `"generated/locked file — skipped"` so navigation still works; the model just knows not to bother reading them.

### 2.3 Tier 1 — format-specific extractors

Tiny per-format functions in `src/codemap/extractors/`. Each is ~10–30 lines.

| File pattern | Extractor output |
| --- | --- |
| `package.json` | `Node project · {name} · {scripts.length} scripts · {deps.length} deps` |
| `tsconfig*.json` | `TS config · target {target} · paths {pathsCount}` |
| `Dockerfile*` | `Container · base: {fromImage} · exposes: {ports.join(",")}` |
| `docker-compose.y(a)ml` | `Compose · services: {svcs.join(",")}` |
| `*.tf` | `Terraform · resources: {resourceTypes.join(",")}` |
| `*.proto` | `Protobuf · {messageCount} messages, {serviceCount} services` |
| `pyproject.toml` | `Python project · {name} · py{requiresPython}` |
| `Cargo.toml` | `Rust crate · {name} v{version} · {depCount} deps` |
| `go.mod` | `Go module · {modulePath} · {requireCount} deps` |
| `*.graphql`, `*.gql` | `GraphQL · {typeCount} types, {queryCount} queries, {mutationCount} mutations` |
| `.github/workflows/*.y(a)ml` | `CI workflow · {name} · triggers: {on}` |
| `*.json` (under 50 KB) | best-effort: top-level keys |
| `*.md` (under 200 lines) | first H1 + first paragraph |

Adding a new format is a single PR with a single function. **No magic.**

### 2.4 Tier 2 — tree-sitter

Replaces the regex skeleton in `walk.ts` for any language with a tree-sitter grammar (~100 supported). Output is precise:

```
src/session/storage.ts
  exports: deleteSession(root, id), loadSession(root, id), saveSession(root, session)
  imports: node:fs/promises, node:path
```

Implementation: `web-tree-sitter` (WASM, ships in a single file) plus per-language grammar `.wasm` files. The WASM build avoids native-binding hell across platforms (a real problem with `tree-sitter` Node bindings on Windows + ARM Macs).

Languages to ship in v1, ordered by adoption: TS, JS, JSX/TSX, Go, Rust, Python, Java, C#, Ruby, PHP, C, C++, Bash. Each grammar is ~100–500 KB. Total ~5 MB shipped.

For each language we author one `.scm` query file capturing:
- top-level declarations (functions, classes, types, traits, interfaces)
- exports / public API
- imports

Tree-sitter results are then **enriched by a one-line LLM call** per file (still batched in tier 3) to add purpose. Output:

```
src/session/storage.ts
  Persists conversation sessions to .bonfire/sessions as JSON. Exports:
  deleteSession, loadSession, saveSession.
```

### 2.5 Tier 3 — LLM fallback (batched, from phase 1)

Anything not handled by tier 0–2 falls through to the batched LLM path. Markdown without an H1, custom DSLs, polyglot files, Vue SFCs (until we ship a Vue extractor), exotic toolchain configs.

This tier should be ≤ 15% of files in most repos. If it's higher, add format extractors for the things you keep seeing.

### Deliverables for phase 2

- `src/codemap/extractors/` directory with the 12 extractors above
- `web-tree-sitter` integration with .scm queries for the 13 v1 languages
- Pipeline router in `src/codemap/extract.ts`
- Per-tier coverage stats in `/codemap` output: *"247 files · 38 dirs · 130 tier-1 · 95 tier-2 · 22 tier-3"*
- Updated benchmark numbers

---

## Phase 3 — SQLite edge index (only when needed)

This phase happens *if and when* tier 2 (tree-sitter) is shipped and we find ourselves wanting to answer questions that the JSON tree can't.

### What changes

Add a `.bonfire/codemap.db` file (SQLite). Schema:

```sql
CREATE TABLE nodes (
  id      INTEGER PRIMARY KEY,
  kind    TEXT NOT NULL,         -- 'file' | 'dir' | 'function' | 'class' | 'type'
  path    TEXT NOT NULL,
  name    TEXT,                  -- function/class name; NULL for files/dirs
  summary TEXT
);

CREATE TABLE edges (
  src   INTEGER NOT NULL REFERENCES nodes(id),
  dst   INTEGER NOT NULL REFERENCES nodes(id),
  kind  TEXT    NOT NULL,        -- 'imports' | 'calls' | 'extends' | 'implements'
  line  INTEGER
);

CREATE INDEX idx_edges_src      ON edges(src, kind);
CREATE INDEX idx_edges_dst      ON edges(dst, kind);
CREATE INDEX idx_nodes_path     ON nodes(path);
```

JSON tree is *kept in addition* — it's still what powers `navigate()`. SQLite is only consulted by new tools (below).

### New tools

```
find_callers(symbol)      → list of (file, line) call sites
find_imports_of(path)     → list of files importing this one
find_definitions(name)    → resolve a name to its declaration site
find_unused_exports()     → exports with no inbound edges
impact_radius(path, depth)→ files transitively touching this one
```

Implemented as standard SQL queries (recursive CTEs for `impact_radius`). Each takes <10 ms at codemap scale.

### Why SQLite, not a graph DB

| Question | SQLite | KuzuDB / Neo4j |
| --- | --- | --- |
| Universal install | yes (Node has `better-sqlite3`) | requires native dep, ~50 MB |
| Single-hop queries (callers, importers) | trivial, fast | trivial, fast |
| Multi-hop traversal (depth ≤ 5) | recursive CTE, fine for ≤500 K edges | nicer Cypher syntax, also fine |
| Pattern queries (longest path, communities) | painful | easy |
| Realistic agent queries | 95% are 1-hop | rarely need >2 hops |

We pay no cost for the future option. If we hit pattern queries that hurt in SQL, we migrate the edge tables to KuzuDB without changing the extraction pipeline.

### Deliverables for phase 3

- `better-sqlite3` dep
- `src/codemap/db.ts` (open + migrate)
- `populateEdges()` in tree-sitter pass
- 5 new tools above
- Documented "when you should not use SQLite" rubric so we know when to graduate

---

## Phase 4 — Graph DB (deferred)

Trigger conditions:

- We've measured SQLite recursive CTEs taking >100 ms on real codemaps and the agent feels it.
- We've added at least three tools with ≥3-hop traversals and the SQL is becoming unmaintainable.
- Or, we want community detection / cluster summaries (GraphRAG-style) for "explain how feature X works."

Likely choice: **KuzuDB**. Cypher, embedded, MIT licensed, real Node bindings.

This phase is a paragraph in this doc, not a plan. We do not work on it speculatively.

---

## Open questions

Things we don't yet know the answer to. Each becomes a sub-issue when we start phase 1.

1. **Optimal batch size by model.** Probably 8 for ≤7B, maybe 12 for 1.7B summary models. Need to measure.
2. **Failure mode for partial JSON.** Repair pass via a tolerant parser? Re-prompt? Drop the batch? Need data.
3. **Tree-sitter on Windows.** WASM build sidesteps native-bindings issues, but startup cost matters. Need a benchmark.
4. **Skill / tool ergonomics for `find_callers` etc.** Should these be one tool with a `kind` parameter, or six tools? Sketch both, see which the model uses well.
5. **Cross-file rename detection** when re-summarising. Today we cache by `(path, mtime)`. Renames look like deletes-plus-adds. Phase 1.5 idea: cache by content hash, mtime as tiebreaker.

---

## What this is *not*

- A spec for a new product. It's a perf and architecture upgrade for an existing feature.
- Locked-in. Every phase has a measure-then-decide gate before the next one.
- Time-boxed in this doc. Concrete owners and target dates land when phase 1 starts.

---

## Reading list

For anyone picking this up:

- [Lost in the Middle (Liu et al., 2023)](https://arxiv.org/abs/2307.03172) — why batched > single-shot
- [Aider's repo-map](https://aider.chat/docs/repomap.html) — the closest existing implementation to phase 2
- [Sourcegraph SCIP](https://github.com/sourcegraph/scip) — what production code-intel storage looks like
- [Microsoft GraphRAG](https://github.com/microsoft/graphrag) — what we are *not* building, and why
- [tree-sitter docs](https://tree-sitter.github.io/) — the substrate for tier 2
- [KuzuDB intro](https://kuzudb.com/docs/) — the deferred graph DB option
