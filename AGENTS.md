# Global Engineering Guard Instructions

The global `engineering-guard` plugin is active.

## Core behavior

The guard must improve engineering quality without preventing the agent from testing, reproducing, probing, or diagnosing problems autonomously.

When something fails, the agent should normally try to understand and reproduce it itself before asking the user.

## Bug fixes, refactors, behavior changes

Use the strict workflow:

```text
RESEARCH
-> reproduce / diagnose when useful
-> engineering_guard_analysis
-> IMPLEMENT
-> DIFF
-> VALIDATE
-> engineering_guard_verification
```

Failure escalation remains enabled for these tasks.

## Test-case / test-script / automation-script generation

Do **not** use bug-style root-cause analysis unless a real implementation defect is discovered.

Use:

```text
search repository
-> read source/info/specification
-> read existing framework format/runner/reference
-> probe/test the API or behavior when useful
-> engineering_guard_generation_plan
-> clean only declared old target scope if requested
-> generate all files in batch
-> inspect diff
-> run targeted validation
-> finish
```

Once `engineering_guard_generation_plan` is accepted, do not call it again for every generated file. The whole current generation task stays unlocked.

Generation-mode validation failures do not trigger failure escalation automatically. Investigate them normally and continue generation.

## Autonomous diagnosis first

When a test, build, API request, script, compile, lint, or reproduction attempt fails:

1. Inspect the actual failure output.
2. Ask internally: **How can I reproduce or isolate this myself?**
3. Try at least one focused diagnostic step before asking the user.
4. Prefer the smallest reproducible test/request/command.
5. Inspect relevant logs, request/response data, status codes, stack traces, runtime state, and nearby code when useful.
6. Use available tools such as curl, HTTPie, Invoke-RestMethod, connectivity checks, existing test runners, or focused scripts.
7. If a temporary script is needed before normal repository modification is unlocked, place it under:

```text
.opencode/engineering-guard/probes/
```

Temporary probes are diagnostic artifacts, not product changes. Remove them when they are no longer useful.

Only ask the user after autonomous diagnosis when the missing information cannot reasonably be obtained from the repository or environment, for example:

- user-only credentials or access
- external system state the agent cannot reach
- missing business intent / expected behavior
- unavailable hardware/environment
- a decision that genuinely belongs to the user

When asking, ask a targeted question and state:

- what was already tried
- what was observed
- exactly what information is still missing

Do not ask generic questions such as "Should I test this?" or "Would you like me to investigate further?". Test and investigate first.

## Diagnostic commands

Normal diagnostic/read operations should remain usable before the modification gate, including common examples such as:

```text
curl / HTTPie
Invoke-WebRequest / Invoke-RestMethod
Test-NetConnection / ping / nslookup
Get-NetTCPConnection
logs / status inspection
existing Python/Node diagnostic scripts
test/build/lint/typecheck commands
```

Commands that explicitly write or mutate repository state remain guarded.

## Common rules

- Never blindly copy old generated test cases as source of truth.
- Prefer specification/info/API behavior over stale generated tests.
- Do not delete unrelated files.
- Do not change expected results just to make a test pass.
- A failed test is evidence to investigate, not an instruction to immediately patch code.
- Only change product code when the diagnosis is supported by evidence.
