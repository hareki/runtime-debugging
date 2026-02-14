---
name: runtime-debugging
description: Use when user reports hard-to-reproduce bugs, race conditions, timing issues, regressions, or says "debug", "trace", or "instrument" - provides hypothesis-driven debugging with real-time log tracing
disable-model-invocation: true
model: opus
---

# Runtime Debugging Skill

Systematic, hypothesis-driven runtime debugging with real-time log tracing. Uses runtime evidence — not guesswork — to find and fix bugs.

## Core Principle

> **NEVER jump to conclusions or make speculative fixes without runtime evidence.**
> ALWAYS: read code → formulate hypotheses → add logging → confirm root cause through logs → apply targeted fix. The goal is precise 2-3 line fixes, not hundreds of lines of speculative code.

## Workflow

```
1. Problem Discovery → ask clarifying questions
2. Codebase Exploration → read files, trace execution, check git history
3. Hypothesis Generation → 5-7 theories with likelihood ratings
4. Start Debug Server
5. Strategic Instrumentation → targeted log points per hypothesis
    ┌──────────────────────────────────────────┐
    │  ITERATIVE LOOP                          │
    │  6. User Reproduces Bug                  │
    │  7. Analyze Logs → Evaluate Hypotheses   │
    │     ├─ ROOT CAUSE FOUND → 8. Fix         │
    │     └─ INCONCLUSIVE → more logging → 6   │
    └──────────────────────────────────────────┘
8. Targeted Fix (minimal, evidence-based)
9. Verify Fix (reproduce again, confirm via logs)
10. Cleanup (remove all instrumentation)
```

---

## Phase 1: Problem Discovery

Gather from user: expected vs actual behavior, reproduction steps, frequency, error messages, recent changes, what's been tried.

## Phase 2: Codebase Exploration

Before hypothesizing: read relevant files, trace execution path, identify data flow, note async/shared-state dependencies, check `git log --oneline -10 -- <file>`.

## Phase 3: Hypothesis Generation

Generate 5-7 hypotheses as a table:

| ID  | Location    | Theory              | Likelihood   | Verification                          |
| --- | ----------- | ------------------- | ------------ | ------------------------------------- |
| A   | `file:func` | What might be wrong | High/Med/Low | What log data would confirm/eliminate |

Think broadly — edge cases, timing, state management. Include hypotheses the user wouldn't have considered.

## Phase 4: Start Debug Server

Ask user about their environment to determine the mode:

- **Local** (default): browser, iOS Simulator, Node.js → host `127.0.0.1`
- **LAN**: Android Emulator (`10.0.2.2`), real devices (Mac's LAN IP), Docker

```bash
# Local mode (default)
SCRIPT_DIR="$HOME/.claude/plugins/installed/runtime-debugging/scripts"; [ ! -d "$SCRIPT_DIR" ] && SCRIPT_DIR="$HOME/.claude/skills/runtime-debugging/scripts"; [ ! -d "$SCRIPT_DIR" ] && SCRIPT_DIR="${PWD}/.claude/skills/runtime-debugging/scripts"; "$SCRIPT_DIR/start-server.sh"

# LAN mode
SCRIPT_DIR="$HOME/.claude/plugins/installed/runtime-debugging/scripts"; [ ! -d "$SCRIPT_DIR" ] && SCRIPT_DIR="$HOME/.claude/skills/runtime-debugging/scripts"; [ ! -d "$SCRIPT_DIR" ] && SCRIPT_DIR="${PWD}/.claude/skills/runtime-debugging/scripts"; "$SCRIPT_DIR/start-server.sh" --lan
```

Server auto-detects if already running. Logs written to `debug.log` (JSONL) in cwd.

## Phase 5: Strategic Instrumentation

**Only instrument code relevant to hypotheses.** For each hypothesis, insert 2-4 log points at: entry, decision, failure, and exit points.

### Instrumentation Rules

1. **Generate a session UUID** per debugging session: `uuidgen | tr '[:upper:]' '[:lower:]'`
2. **Wrap all log code** in region markers for cleanup: `#region debug-trace` / `#endregion` (use language-appropriate comment syntax)
3. **Send HTTP POST** to `http://<HOST>:7243/ingest/<SESSION_UUID>` with JSON body
4. **Always error-safe** — logging failures must never break business logic (e.g., `.catch(()=>{})`, `try/except`, goroutine)
5. **Never log sensitive data** (passwords, tokens, PII)

### Log Entry Schema

```json
{
  "location": "File.ts:functionName",
  "message": "descriptive message",
  "level": "info|warn|error|debug",
  "data": {
    /* arbitrary context */
  },
  "error": { "message": "...", "stack": "...", "name": "..." },
  "timestamp": 1703000000000,
  "sessionId": "session-uuid",
  "hypothesisId": "A"
}
```

### What to Capture

- Input params with types, existence checks, collection sizes
- For errors: `message`, `stack`, `name`
- For async: timestamps before/after operations
- For state: before/after mutation snapshots

### Language-Specific Instrumentation Examples

Copy and adapt these helpers when instrumenting. Each follows the rules above: fire-and-forget, error-safe, region-wrapped.

#### TypeScript / JavaScript

```typescript
// #region debug-trace
const DEBUG_URL = 'http://127.0.0.1:7243/ingest/SESSION_UUID';

function debugLog(
  location: string,
  message: string,
  hypothesisId: string,
  data?: Record<string, unknown>,
  error?: Error
) {
  fetch(DEBUG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location,
      message,
      level: error ? 'error' : 'info',
      data,
      error: error ? { message: error.message, stack: error.stack, name: error.name } : undefined,
      timestamp: Date.now(),
      hypothesisId,
    }),
  }).catch(() => {});
}
// #endregion
```

#### Go

```go
// #region debug-trace
const debugURL = "http://127.0.0.1:7243/ingest/SESSION_UUID"

func debugLog(location, message, hypothesisId string, data map[string]any, err error) {
	go func() {
		entry := map[string]any{
			"location":     location,
			"message":      message,
			"level":        "info",
			"data":         data,
			"timestamp":    time.Now().UnixMilli(),
			"hypothesisId": hypothesisId,
		}
		if err != nil {
			entry["level"] = "error"
			entry["error"] = map[string]string{"message": err.Error(), "name": fmt.Sprintf("%T", err)}
		}
		body, _ := json.Marshal(entry)
		resp, err := http.Post(debugURL, "application/json", bytes.NewReader(body))
		if err == nil {
			resp.Body.Close()
		}
	}()
}
// #endregion
```

#### Neovim / Lua

```lua
-- #region debug-trace
local DEBUG_URL = "http://127.0.0.1:7243/ingest/SESSION_UUID"

local function debug_log(location, message, hypothesis_id, data)
  pcall(function()
    local entry = vim.json.encode({
      location = location,
      message = message,
      level = "info",
      data = data,
      timestamp = math.floor(vim.loop.now()),
      hypothesisId = hypothesis_id,
    })
    vim.fn.jobstart({
      "curl", "-s", "-X", "POST", DEBUG_URL,
      "-H", "Content-Type: application/json",
      "-d", entry,
    }, { detach = true })
  end)
end
-- #endregion
```

## Phase 6: User Reproduces

1. **Clear logs first**: `> debug.log` or `curl -X DELETE http://127.0.0.1:7243/logs`
2. Give user **specific, numbered steps** to reproduce
3. For intermittent bugs: ask user to reproduce multiple times

## Phase 7: Analyze Logs

Read `debug.log` (JSONL). Use `jq` to filter:

```bash
cat debug.log | jq 'select(.hypothesisId == "A")'     # by hypothesis
cat debug.log | jq 'select(.level == "error")'         # errors only
cat debug.log | jq -r '[.timestamp, .hypothesisId, .location, .message] | @tsv' | sort -n  # timeline
```

Or use server API: `curl -s "http://127.0.0.1:7243/logs?hypothesis=A&level=error" | jq .`

Evaluate each hypothesis as: **CONFIRMED**, **ELIMINATED**, **INCONCLUSIVE**, or **NOT REACHED**.

### If INCONCLUSIVE — Iterate

Generate new sub-hypotheses, add deeper logging, clear logs, reproduce again. **Don't give up** — multiple rounds are expected.

## Phase 8: Targeted Fix

Apply a **precise 2-3 line fix** that directly addresses the confirmed root cause. No speculative changes. Keep instrumentation in place until verified.

## Phase 9: Verify Fix

Clear logs, ask user to reproduce, check logs confirm the fix works. Only declare fixed when **logs prove it**.

## Phase 10: Cleanup

Remove all `#region debug-trace` blocks. Use `grep -rn "#region debug-trace"` to preview, then `sed` to remove:

```bash
# Example for JS/TS files
find <dir> -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) -exec sed -i '' '/\/\/ #region debug-trace/,/\/\/ #endregion/d' {} +
```

Adapt the comment syntax and file extensions for the target language.

Optionally stop the server:

```bash
SCRIPT_DIR="$HOME/.claude/plugins/installed/runtime-debugging/scripts"; [ ! -d "$SCRIPT_DIR" ] && SCRIPT_DIR="$HOME/.claude/skills/runtime-debugging/scripts"; [ ! -d "$SCRIPT_DIR" ] && SCRIPT_DIR="${PWD}/.claude/skills/runtime-debugging/scripts"; "$SCRIPT_DIR/start-server.sh" --stop
```

---

## Server API Quick Reference

| Method   | Path                         | Description                                                         |
| -------- | ---------------------------- | ------------------------------------------------------------------- |
| `POST`   | `/ingest/<session-id>`       | Ingest log entry                                                    |
| `POST`   | `/ingest/<session-id>/batch` | Batch ingest: `{ entries: [...] }`                                  |
| `GET`    | `/health`                    | Health check                                                        |
| `GET`    | `/logs`                      | Query with filters: `?hypothesis=A&level=error&search=text&tail=10` |
| `GET`    | `/logs/stats`                | Statistics by hypothesis/level/location                             |
| `GET`    | `/logs/timeline`             | Execution timeline                                                  |
| `DELETE` | `/logs`                      | Clear all logs                                                      |

---

## Key Rules

1. **Hypotheses first** — never blindly scatter logs
2. **No guessing** — no fix without log evidence
3. **Region markers** for all instrumentation
4. **Error-safe logging** — never break business logic
5. **Fresh UUID** per session
6. **Iterate** — inconclusive? add more logging, reproduce again
7. **Minimal fixes** — 2-3 lines, not a rewrite
8. **Always verify** — prove the fix works via logs
