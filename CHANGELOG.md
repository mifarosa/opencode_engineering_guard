# Changelog

## v4

- Added autonomous diagnosis-first behavior.
- Diagnostic commands are allowed before strict product modification unlock.
- Added support for common API/network probes such as curl, HTTPie, Invoke-RestMethod and connectivity inspection.
- Existing Python/Node/Java diagnostic scripts may be run before product edits are unlocked.
- Added temporary diagnostic probe area: `.opencode/engineering-guard/probes/`.
- Writes under the diagnostic probe area do not count as product modifications.
- Failed diagnostic/validation commands now push the model toward reproduction and isolation before asking the user or patching code.
- User questions remain allowed, but should happen after autonomous attempts when information is genuinely unavailable.
- Improved shell exit-code detection across different OpenCode metadata shapes.
- Preserved v3 generation mode and v2 failure escalation.

## v3

- Added `generation` guard profile.
- Added `engineering_guard_generation_plan`.
- Test-case/test-script generation no longer requires fake bug root-cause analysis.
- Generation gate unlocks batch modifications for the entire current task.
- Failure escalation is disabled during normal generation mode.
- Strict bug-fix workflow and failure escalation remain available.
- Block messages explicitly tell generation tasks to use the generation-plan tool.

## v2

- Added automatic failure escalation.
- Added adversarial `engineering_guard_critic`.
- Increased evidence requirements after repeated failures.

## v1

- Initial runtime modification guard.
