# OpenCode Engineering Guard

A global OpenCode plugin that prevents coding agents from jumping from the first plausible search result directly into repository modifications.

It enforces an evidence-first engineering workflow at runtime rather than relying only on prompts.

## Workflow

Normal tasks:

```text
User request
   ↓
Search repository
   ↓
Read target code
   ↓
Read related caller / callee / test / config
   ↓
engineering_guard_analysis
   ↓
EDIT UNLOCK
   ↓
Modify repository
   ↓
git diff
   ↓
Targeted test / build / lint / typecheck
   ↓
engineering_guard_verification
   ↓
Finish
```

## Failure escalation

Repeated failed attempts automatically trigger a stricter mode.

The current implementation escalates when either:

- 2 validation commands fail during the same task, or
- post-change verification is rejected 2 times.

After escalation:

```text
Failed attempt
   ↓
ESCALATION
   ↓
More repository searches
   ↓
Read more related files
   ↓
Re-evaluate previous root cause
   ↓
Stronger engineering_guard_analysis
   ↓
engineering_guard_critic
   ↓
Critic verdict?
   ├── revise → investigate again
   └── accept
          ↓
       EDIT UNLOCK
          ↓
       New implementation
          ↓
       Diff + validation
```

This is designed to stop the common agent failure pattern:

```text
search
→ first plausible match
→ patch
→ test fails
→ patch same assumption again
→ test fails
→ patch again
```

Instead the agent is forced to obtain new evidence and challenge its own diagnosis.

## Escalated requirements

Normal mode requires:

- at least 1 repository search
- at least 2 relevant files read
- at least 2 evidence sources
- at least 1 alternative hypothesis checked
- accepted `engineering_guard_analysis`

Escalated mode requires:

- at least 2 repository searches
- at least 3 relevant files read
- at least 3 distinct evidence sources
- at least 2 alternative hypotheses checked
- explanation of why the previous attempt failed
- accepted `engineering_guard_analysis`
- accepted `engineering_guard_critic`

## Runtime enforcement

The plugin intercepts repository-changing tool calls.

Direct modification tools such as:

```text
edit
write
patch
apply_patch
```

are blocked until the guard requirements pass.

Potentially modifying shell commands are also blocked before analysis.

Examples:

```text
rm
mv
cp
Remove-Item
Move-Item
Set-Content
git reset
git restore
git checkout
git apply
npm install
pip install
```

Known read-only commands remain available for investigation:

```text
git status
git diff
git log
git show
rg
grep
cat
Get-Content
Get-ChildItem
Select-String
```

Unknown shell commands are treated conservatively as potentially modifying.

## Internal tools

The plugin exposes three tools to the model.

### `engineering_guard_analysis`

Required before repository modification.

The model must provide:

- root cause / technical explanation
- evidence from files actually read in the current session
- alternative hypotheses checked
- affected areas
- proposed change
- risks

During escalation it must also explain why the previous attempt failed.

### `engineering_guard_critic`

Required only after failure escalation.

The critic must review:

- weaknesses in the current diagnosis
- alternative root causes
- missed code areas
- regression risks

Verdict must be exactly:

```text
accept
```

or:

```text
revise
```

A `revise` verdict locks modification again and sends the agent back to investigation.

### `engineering_guard_verification`

Required after repository modification.

The guard checks that:

- `git diff` was actually observed
- claimed validation commands were actually executed
- relevant validation succeeded or the model explicitly states why it is unavailable
- the model confirms the solution after validation

## Global installation

OpenCode loads the plugin from the user's global configuration directory:

```text
~/.config/opencode/
```

On Windows this is typically:

```text
C:\Users\<username>\.config\opencode\
```

Install layout:

```text
.config/
└── opencode/
    ├── AGENTS.md
    └── plugins/
        └── engineering-guard.ts
```

## Windows installation

Clone or download this repository.

Open PowerShell in the repository directory:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-engineering-guard.ps1
```

Then fully close OpenCode and start it again.

The installer backs up an existing guard plugin before replacing it.

## Updating

Pull the repository and run the installer again:

```powershell
git pull
.\install-engineering-guard.ps1
```

Then restart OpenCode.

## Emergency disable

If a provider or OpenCode update becomes incompatible with the plugin:

```powershell
$env:OPENCODE_ENGINEERING_GUARD = "0"
opencode
```

To remove the variable:

```powershell
Remove-Item Env:OPENCODE_ENGINEERING_GUARD -ErrorAction SilentlyContinue
```

## Basic test

Open a repository and ask the model:

```text
Find the cause of this bug and fix it.
```

If the model attempts to modify too early, it should receive:

```text
ENGINEERING POLICY: MODIFICATION BLOCKED
```

The model should continue autonomously without asking the user for permission.

## Failure escalation test

Use a task where the first proposed fix is intentionally wrong or where validation fails twice.

After the second failed validation you should see guard logs indicating:

```text
POLICY failure escalation activated
```

The model should then:

1. return to investigation
2. inspect additional files
3. submit a stronger analysis
4. invoke `engineering_guard_critic`
5. modify only after critic acceptance

## Logging

The plugin writes structured OpenCode logs such as:

```text
POLICY task reset
POLICY modification blocked
POLICY analysis accepted
POLICY validation failed
POLICY failure escalation activated
POLICY critic requested revision
POLICY critic accepted
POLICY verification rejected
POLICY verification accepted
```

## Repository files

```text
engineering-guard.ts
AGENTS.md
install-engineering-guard.ps1
README.md
LICENSE
```

## Design principle

Do not merely ask the model to be careful.

Make unsafe engineering shortcuts impossible at the runtime layer.
