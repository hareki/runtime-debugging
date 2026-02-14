# Runtime Debugging Skill for Claude Code

**Hypothesis-driven debugging with real-time log tracing**

A Claude Code skill that brings systematic runtime debugging to any language/environment. Uses runtime evidence — not guesswork — to find and fix bugs.

## Quick Start

### 1. Install

**Option A: Claude Code Plugin (Recommended)**

```bash
claude plugin marketplace add hareki/runtime-debugging
claude plugin install runtime-debugging@hareki-runtime-debugging
```

**Option B: Manual Installation**

```bash
# Global (recommended)
git clone https://github.com/hareki/runtime-debugging.git ~/.claude/skills/runtime-debugging

# Or project-level
git clone https://github.com/hareki/runtime-debugging.git .claude/skills/runtime-debugging
```

### 2. Ask Claude to debug

```
Debug why the save button doesn't work sometimes
```

Claude will explore the codebase, generate hypotheses, start the debug server, instrument code, ask you to reproduce, analyze logs, iterate if inconclusive, apply a targeted fix, verify, and clean up.

## How It Works

```
┌─────────────────┐     HTTP POST      ┌─────────────────┐
│   Your App      │ ─────────────────► │  Debug Server   │
│  (instrumented) │                    │  (port 7243)    │
└─────────────────┘                    └────────┬────────┘
                                                │
                                           ┌────▼────┐
                                           │ debug   │
                                           │  .log   │
                                           │ (JSONL) │
                                           └─────────┘
```

Instrumented code sends structured log entries via HTTP POST to a local server. Logs are written to `debug.log` (JSONL). The agent uses `#region debug-trace` / `#endregion` markers on all instrumentation for easy cleanup. Works with any language that can make HTTP requests.

## Environment Support

| Environment             | Host            | Server Mode     |
| ----------------------- | --------------- | --------------- |
| Mac Browser / Node.js   | `127.0.0.1`     | Local (default) |
| iOS Simulator           | `127.0.0.1`     | Local           |
| Android Emulator        | `10.0.2.2`      | LAN (`--lan`)   |
| Real iOS/Android Device | Mac's LAN IP    | LAN (`--lan`)   |
| Docker Container        | Host machine IP | LAN (`--lan`)   |

## Server Management

```bash
./start-server.sh              # Start (local mode)
./start-server.sh --lan        # Start (LAN mode for devices)
./start-server.sh --port 8080  # Custom port
./start-server.sh --restart    # Kill and restart
./start-server.sh --stop       # Stop the server
./start-server.sh --clear      # Clear logs
./start-server.sh --status     # Check server status
```

## Server API

| Method   | Path                         | Description                                                          |
| -------- | ---------------------------- | -------------------------------------------------------------------- |
| `POST`   | `/ingest/<session-id>`       | Ingest a single log entry                                            |
| `POST`   | `/ingest/<session-id>/batch` | Batch ingest: `{ entries: [...] }`                                   |
| `GET`    | `/health`                    | Health check                                                         |
| `GET`    | `/logs`                      | Query with filters: `?hypothesis=A&level=error&search=text&tail=10`  |
| `GET`    | `/logs/stats`                | Statistics by hypothesis/level/location                              |
| `GET`    | `/logs/timeline`             | Execution timeline                                                   |
| `DELETE` | `/logs`                      | Clear all logs                                                       |

## Log Format

Logs are JSONL (newline-delimited JSON):

```json
{
  "_seq": 1,
  "_receivedAt": 1703000000000,
  "location": "File.ts:validateEmail",
  "message": "validation result",
  "level": "error",
  "data": { "email": "user+tag@email.com", "isValid": false },
  "error": { "message": "Invalid email format", "stack": "..." },
  "timestamp": 1703000000000,
  "sessionId": "abc-123",
  "hypothesisId": "B"
}
```

## Example Session

**User:** "The save button doesn't work sometimes"

**Claude** explores codebase, generates hypotheses, instruments, asks user to reproduce, then analyzes logs:

```
| ID | Status | Evidence |
|----|--------|----------|
| A  | ELIMINATED | onClick fires every time (5/5 clicks logged) |
| B  | CONFIRMED | validate() returns false for email "user+tag@email.com" |
| C  | NOT REACHED | save() never called when B fails |
| E  | CONFIRMED | /^[a-zA-Z0-9._-]+@/ regex rejects '+' character |

ROOT CAUSE: Email regex rejects valid '+' addressed emails.
FIX: /^[a-zA-Z0-9._-]+@/ → /^[a-zA-Z0-9._+\-]+@/
```

After fix + verification run: validate() returns `true`, save() called successfully.

## Cleanup

All instrumentation uses `#region debug-trace` / `#endregion` markers. To remove:

```bash
grep -rn "#region debug-trace" src/           # Preview
find src -type f -name "*.ts" \
  -exec sed -i '' '/\/\/ #region debug-trace/,/\/\/ #endregion/d' {} +
```

Adapt comment syntax (`//`, `#`, `--`) and file extensions for the target language.

## Requirements

- Node.js (for the debug server)
- Claude Code CLI

## License

MIT
