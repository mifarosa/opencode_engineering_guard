# OpenCode Engineering Guard v4

A global OpenCode runtime guard that improves coding-agent reliability without preventing autonomous testing and diagnosis.

V4 changes the guard philosophy from:

```text
protect edits first
```

to:

```text
let the agent investigate and test freely
-> guard unsupported product changes
```

The agent should try to reproduce and diagnose a problem itself before asking the user.

## Main workflows

### Strict engineering mode

For bug fixes, refactors and behavior changes:

```text
search
-> inspect target + related code
-> reproduce / probe / diagnose when useful
-> engineering_guard_analysis
-> product modification
-> git diff
-> targeted validation
-> engineering_guard_verification
```

Unsupported product modifications are blocked, but diagnostic activity is intentionally available before the edit gate.

### Generation mode

For test cases, test scripts, automation scripts and fixtures:

```text
search
-> inspect info/specification
-> inspect framework format/runner/reference
-> test/probe API or behavior when needed
-> engineering_guard_generation_plan
-> BATCH GENERATION UNLOCKED
-> optional scoped cleanup
-> create/edit generated files
-> diff
-> targeted validation
```

The generation gate runs once per current user task, not once per generated file.

## Autonomous diagnosis

When a command or test fails, V4 pushes the agent toward diagnosis instead of immediately asking the user or guessing another patch.

Expected behavior:

```text
failure
-> inspect output
-> reproduce with smallest useful test
-> inspect logs/request/response/state/code
-> try focused diagnostic
-> decide whether diagnosis is supported
   ├── yes -> fix
   └── no  -> continue investigation or ask one targeted user question
```

The user does not need to manually say:

```text
try curl
check the logs
run the test yourself
see if you can reproduce it
```

The agent is instructed to do those things first when practical.

## Diagnostic commands are allowed before edit unlock

V4 explicitly recognizes common diagnostic operations such as:

```text
curl / curl.exe
HTTPie
Invoke-WebRequest
Invoke-RestMethod
Test-NetConnection
ping
tracert / traceroute
nslookup / Resolve-DnsName
Get-NetTCPConnection
netstat / ss / lsof
openssl s_client
docker logs / ps / inspect
kubectl get / describe / logs
existing Python scripts
existing Node scripts
existing Java/JAR diagnostic runs
```

Normal test/build/lint/typecheck commands are also available before product modification is unlocked.

Explicitly mutating forms remain guarded. For example, `curl -o file` or a command using output redirection is treated as a write rather than a read-only probe.

## Temporary diagnostic probes

Sometimes the best way to understand a failure is to create a tiny reproduction script.

V4 allows the agent to create temporary diagnostic files under:

```text
.opencode/engineering-guard/probes/
```

Example:

```text
.opencode/engineering-guard/probes/reproduce_parser_bug.py
```

These files:

- can be created before the normal root-cause edit gate
- do not count as product modifications
- are intended only for reproduction / diagnosis
- should be removed when no longer needed

The guard still blocks arbitrary product-code edits until the appropriate analysis/generation gate passes.

## Asking the user

V4 does **not** forbid questions.

It changes the order:

```text
BAD
failure -> ask user what to do

GOOD
failure
-> try to reproduce
-> inspect evidence
-> run focused diagnostics
-> ask user only if required information is unavailable
```

A useful user question should explain:

- what the agent already tried
- what it observed
- what exact missing information is needed

Typical valid reasons to ask:

- credentials/access only the user can provide
- an external system is inaccessible from the environment
- expected business behavior is ambiguous
- required hardware/data is unavailable
- user preference/decision is genuinely needed

## Failure guidance

When a diagnostic or validation shell command fails, the guard attempts to append guidance to the native tool result telling the model to:

1. inspect the failure
2. isolate/reproduce it
3. try another focused diagnostic
4. inspect relevant state/logs/code
5. avoid changing code until evidence supports the diagnosis

OpenCode's current plugin API supports observing tool results; behavior of rendered after-hook annotations can vary between OpenCode versions and tool types, so the same rules are also injected into the global system instructions.

## Failure escalation

Strict bug-fix work still supports escalation.

Repeated failed validations can lead to:

```text
FAIL
-> autonomous diagnosis
-> FAIL again
-> ESCALATION
-> more searches/files/evidence
-> stronger engineering_guard_analysis
-> engineering_guard_critic
-> revised implementation
```

Generation mode does not automatically escalate simply because generated test cases fail. Test failures may be part of API/data discovery and should first be diagnosed normally.

## Runtime tools

### `engineering_guard_analysis`

Used for real bug fixes / behavior changes before product modification.

### `engineering_guard_critic`

Used after strict-mode failure escalation to challenge the revised diagnosis.

### `engineering_guard_generation_plan`

Used once for test/script/fixture generation to unlock batch generation.

### `engineering_guard_verification`

Used after product changes to verify diff review and actual validation.

## Installation

Windows:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-engineering-guard.ps1
```

Then fully close and restart OpenCode.

Global install location:

```text
%USERPROFILE%\.config\opencode\
├── AGENTS.md
└── plugins\
    └── engineering-guard.ts
```

## Updating from v3

Run the v4 installer from this repository:

```powershell
.\install-engineering-guard.ps1
```

The installer backs up the existing plugin before replacing it.

Then restart OpenCode.

## Emergency disable

```powershell
$env:OPENCODE_ENGINEERING_GUARD = "0"
opencode
```

Re-enable:

```powershell
Remove-Item Env:OPENCODE_ENGINEERING_GUARD -ErrorAction SilentlyContinue
```

## Example: API test generation

Prompt:

```text
Delete the old generated test cases in the requested scope, inspect the info folder from scratch, understand the API/test framework format, test the actual API with curl/HTTPie when necessary, then regenerate and validate the requested cases.
```

Expected behavior:

```text
search/read
-> curl/probe if useful
-> engineering_guard_generation_plan
-> GENERATION MODE UNLOCKED
-> cleanup target scope
-> generate many test files
-> run cases
-> if one fails: diagnose it autonomously
-> continue/fix based on evidence
```

## Example: bug diagnosis

```text
User: Fix this API client bug.

Agent:
search/read
-> reproduce request with curl
-> inspect status/body/logs
-> run focused local probe
-> engineering_guard_analysis
-> edit
-> targeted test
-> verification
```

If the environment cannot reach the API, the agent may then ask a targeted question such as what network/proxy context is required, while stating the connectivity checks it already attempted.

## Files

- `engineering-guard.ts`
- `AGENTS.md`
- `install-engineering-guard.ps1`
- `README.md`
- `CHANGELOG.md`
- `LICENSE`
