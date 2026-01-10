# Runtime Debugging Skill for Claude Code

**Hypothesis-driven debugging with real-time log tracing — inspired by Cursor's debug mode**

A Claude Code skill that brings systematic runtime debugging to any JavaScript/TypeScript environment: browsers, React Native, Node.js, and more.

## Why This Exists

Traditional debugging with `console.log` is chaotic. You scatter logs everywhere, restart the app, and hope you guessed right. This skill teaches Claude to debug like an expert:

1. **Generate hypotheses first** — Before touching code, identify 5-7 possible failure points
2. **Instrument strategically** — Only add logs that test specific hypotheses
3. **Eliminate systematically** — Use evidence to confirm or rule out each theory
4. **Clean up completely** — Remove all instrumentation when done

## Quick Start

### 1. Install

**Global (recommended):**
```bash
git clone https://github.com/originalix/runtime-debugging.git ~/.claude/skills/runtime-debugging
```

**Project-level:**
```bash
git clone https://github.com/originalix/runtime-debugging.git .claude/skills/runtime-debugging
```

### 2. Ask Claude to debug

```
Debug why position lines aren't showing on the chart
```

Claude will:
- Ask clarifying questions about the issue
- Generate hypotheses with likelihood ratings
- **Automatically start the debug server** (no manual setup needed)
- Instrument your code with targeted log points
- **Clear logs before each reproduction** for clean traces
- Analyze logs and identify the root cause

## How It Works

```
┌─────────────────┐     HTTP POST      ┌─────────────────┐
│   Your App      │ ─────────────────► │  Debug Server   │
│  (instrumented) │                    │  (port 7243)    │
└─────────────────┘                    └────────┬────────┘
                                                │
                                                ▼
                                       ┌─────────────────┐
                                       │   debug.log     │
                                       │    (JSONL)      │
                                       └─────────────────┘
```

The skill injects `fetch()` calls that send structured log data to a local server. Logs are written to `debug.log` in your project root for analysis.

## Environment Support

Claude will ask about your environment and configure the correct host automatically:

| Environment | Host in fetch() |
|-------------|-----------------|
| Mac Browser | `127.0.0.1` |
| iOS Simulator | `127.0.0.1` |
| Android Emulator | `10.0.2.2` |
| Real iOS/Android Device | Your Mac's LAN IP |

## Log Format

Logs are JSONL (newline-delimited JSON):

```json
{"location":"File.ts:42","message":"function entry","data":{"param":"value"},"timestamp":1234567890,"hypothesisId":"A"}
```

Filter by hypothesis:
```bash
cat debug.log | jq 'select(.hypothesisId == "A")'
```

## Example Session

**User:** "The save button doesn't work sometimes"

**Claude generates hypotheses:**

| ID | Location | Theory | Likelihood |
|----|----------|--------|------------|
| A | `onClick` handler | Event not firing | Medium |
| B | `validateForm()` | Validation failing silently | High |
| C | `saveData()` | API call rejected | Medium |
| D | State update | Race condition | Low |

**After instrumentation and reproduction:**

```
Hypothesis Analysis:

| ID | Status | Evidence |
|----|--------|----------|
| A  | ELIMINATED | onClick fires every time |
| B  | CONFIRMED | Returns false when email contains '+' |
| C  | - | Not reached |

ROOT CAUSE: Email regex rejects valid addresses with '+' character.
```

## Cleanup

All instrumentation is wrapped in markers for easy removal:

```bash
# Preview
grep -n "#region agent log" src/

# Remove all
sed -i '' '/\/\/ #region agent log/,/\/\/ #endregion/d' src/**/*.ts
```

## Requirements

- Node.js (for the debug server)
- Claude Code CLI

## License

MIT
