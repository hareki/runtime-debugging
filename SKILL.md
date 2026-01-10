# Runtime Debugging Skill

Debug runtime issues by systematically analyzing potential failure points and instrumenting code with trace logs.

## Trigger

Use this skill when:
- User asks to debug a file or function
- User encounters hard-to-reproduce runtime issues
- User wants to trace execution flow
- User says "debug", "trace", "instrument", or similar

## Workflow

### Phase 1: Problem Discovery

**Ask the user to describe the issue clearly.** Gather:

1. **What is the expected behavior?**
2. **What is the actual behavior?**
3. **When does it happen?** (Always? Sometimes? After specific actions?)
4. **Any error messages or console output?**
5. **What has been tried already?**

Example questions to ask:
```
Before I start debugging, I need to understand the issue better:

1. What behavior are you expecting vs what's actually happening?
2. Is this reproducible every time, or intermittent?
3. Are there any error messages in console/logs?
4. When did this start happening? Any recent changes?
```

### Phase 2: Hypothesis Generation

Based on the problem description, **generate 5-7 hypotheses** about where the bug might be.

Structure each hypothesis with:
- **ID**: A, B, C, D, E, F, G
- **Location**: Specific file/function/line range
- **Theory**: What might be going wrong
- **Likelihood**: High / Medium / Low
- **Verification**: What log data would confirm or eliminate this hypothesis

Example output format:
```
Based on your description, here are my hypotheses:

| ID | Location | Theory | Likelihood |
|----|----------|--------|------------|
| A  | `syncLines()` entry | Payload data malformed or missing fields | High |
| B  | `validatePayload()` | Symbol mismatch rejecting valid data | Medium |
| C  | `createLine()` | Price parsing failing for certain formats | Medium |
| D  | `applyPositionLineStyle()` | Style object missing required properties | Low |
| E  | `chart.createPositionLine()` | TradingView API returning null/undefined | Medium |
| F  | Event timing | Data arriving before chart is ready | High |
| G  | State sync | Stale cache interfering with new data | Low |

I'll instrument the code to test these hypotheses. Which ones would you like me to prioritize?
```

### Phase 3: Start Debug Server

**Ask the user about their debugging environment:**

| Environment | Host in fetch() | Requires LAN mode? |
|-------------|-----------------|-------------------|
| Mac Browser | `127.0.0.1` | No |
| iOS Simulator | `127.0.0.1` | No |
| Android Emulator | `10.0.2.2` | Yes |
| iOS/Android Real Device | Mac's LAN IP | Yes |

**After the user answers, automatically start the debug server** using the appropriate mode:

```bash
# Local mode (default) - for browser, iOS Simulator
SKILL_DIR="$HOME/.claude/skills/runtime-debugging/scripts"; [ ! -d "$SKILL_DIR" ] && SKILL_DIR="${PWD}/.claude/skills/runtime-debugging/scripts"; "$SKILL_DIR/start-server.sh"

# LAN mode - only for Android Emulator or real devices
SKILL_DIR="$HOME/.claude/skills/runtime-debugging/scripts"; [ ! -d "$SKILL_DIR" ] && SKILL_DIR="${PWD}/.claude/skills/runtime-debugging/scripts"; "$SKILL_DIR/start-server.sh" --lan
```

**Default behavior**: If the user doesn't mention Android Emulator or real device, use local mode (`127.0.0.1`).

The server will automatically detect if it's already running and skip startup if so. Logs are written to `debug.log` in the current working directory.

### Phase 4: Strategic Instrumentation

**Only instrument code relevant to the hypotheses.** Don't blanket the entire codebase.

For each hypothesis, insert 2-4 targeted log points:
1. **Entry point** - Capture inputs
2. **Decision point** - Capture branch condition
3. **Failure point** - Capture error or unexpected state
4. **Exit point** - Capture result

#### Log Template (single-line)

```typescript
// #region agent log
fetch('http://127.0.0.1:7243/ingest/<SESSION_UUID>',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'<FileName.ts>:<line>',message:'<descriptive message>',data:{<context>},timestamp:Date.now(),sessionId:'<session-id>',runId:'<run-id>',hypothesisId:'<H>'})}).catch(()=>{});
// #endregion
```

#### Session UUID
Generate a new UUID for each debugging session:
```bash
uuidgen | tr '[:upper:]' '[:lower:]'
```

#### Hypothesis ID Mapping
Use the same IDs from Phase 2:
- **A-G**: Corresponds to your generated hypotheses
- This allows filtering logs by hypothesis during analysis

#### Data Collection Guidelines
- Capture input parameters with their types
- Include existence checks: `!!value`, `value !== undefined`
- Include type checks: `typeof x`, `x instanceof Y`
- Include collection sizes: `.length`, `.size`
- For errors: include `message` and `stack`
- NEVER log sensitive data (passwords, tokens, PII)

### Phase 5: User Reproduces Issue

**Before asking the user to reproduce, always clear the log file first:**

```bash
> debug.log
```

Then instruct the user to trigger the problematic scenario in their application. The debug server will display logs in real-time.

### Phase 6: Analyze & Eliminate Hypotheses

Read `debug.log` and systematically evaluate each hypothesis:

```bash
# View all logs
cat debug.log | jq .

# Filter by specific hypothesis
cat debug.log | jq 'select(.hypothesisId == "A")'

# View execution timeline
cat debug.log | jq -r '[.timestamp, .hypothesisId, .location, .message] | @tsv'
```

For each hypothesis, determine:
- **CONFIRMED**: Logs show this is the issue
- **ELIMINATED**: Logs prove this is NOT the issue
- **INCONCLUSIVE**: Need more log points

Report findings:
```
Hypothesis Analysis Results:

| ID | Status | Evidence |
|----|--------|----------|
| A  | ELIMINATED | Payload structure is correct, all fields present |
| B  | ELIMINATED | Symbol matches, validation passes |
| C  | CONFIRMED | Price "12,345.67" fails parseFloat (returns NaN) |
| D  | - | Not reached (earlier failure) |
| E  | - | Not reached (earlier failure) |

ROOT CAUSE: Hypothesis C confirmed. Price strings with comma separators
fail parseFloat(). Need to strip commas before parsing.
```

### Phase 7: Fix & Verify

1. Propose a fix based on confirmed hypothesis
2. User applies fix
3. Clear log file (`> debug.log`) and ask user to reproduce again
4. Verify the issue is resolved by checking logs
5. Clean up instrumentation code

### Phase 8: Cleanup

Remove all instrumentation code:

```bash
# Preview what will be removed
grep -n "#region agent log" <file>

# Remove all agent log blocks
sed -i '' '/\/\/ #region agent log/,/\/\/ #endregion/d' <file>
```

## Log File Format

`debug.log` is JSONL format (newline-delimited JSON):

```json
{"location":"File.ts:42","message":"function entry","data":{"param1":"value"},"timestamp":1234567890,"sessionId":"abc","runId":"run1","hypothesisId":"A"}
{"location":"File.ts:50","message":"validation check","data":{"isValid":true},"timestamp":1234567891,"sessionId":"abc","runId":"run1","hypothesisId":"C"}
```

## Important Notes

1. **Hypotheses first, instrumentation second** - Don't blindly add logs everywhere
2. Log code must be **single-line** to minimize visual noise in source code
3. Always use `.catch(()=>{})` to ensure log failures don't break business logic
4. Each new debugging session should use a fresh SESSION_UUID
5. Ensure `debug.log` is in `.gitignore`
6. The `// #region agent log` markers enable easy bulk removal
7. Server auto-handles CORS for browser environments

## Example Session

### User's Problem:
"Position lines aren't showing up on the chart"

### Generated Hypotheses:
| ID | Location | Theory | Likelihood |
|----|----------|--------|------------|
| A  | `syncLines()` | Payload never received or rejected | High |
| B  | `validatePayload()` | Symbol/revision validation failing | Medium |
| C  | `createLine()` | Line creation throwing silently | High |
| D  | `parseFloat(price)` | Invalid price format | Medium |
| E  | `chart.createPositionLine()` | TradingView API error | Medium |
| F  | `applyPositionLineStyle()` | Style application error | Low |

### After Instrumentation & Reproduction:

```
Hypothesis Analysis:

| ID | Status | Evidence |
|----|--------|----------|
| A  | ELIMINATED | syncLines called with 3 lines |
| B  | ELIMINATED | Validation passed |
| C  | CONFIRMED | createLine throws "Cannot read property 'createPositionLine' of undefined" |
| D  | - | Not reached |
| E  | - | Not reached |
| F  | - | Not reached |

ROOT CAUSE: chart.createPositionLine() called before chart is ready.
The widget.activeChart() returns undefined during initial load.

FIX: Add chart readiness check before creating lines.
```
