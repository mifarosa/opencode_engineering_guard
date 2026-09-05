# Global Engineering Guard Instructions

The global `engineering-guard` plugin is active.

For repository-changing tasks, follow its runtime-enforced workflow automatically:

RESEARCH -> ANALYZE -> VERIFY HYPOTHESIS -> IMPLEMENT -> REVIEW DIFF -> VALIDATE -> VERIFY RESULT -> FINISH

## Normal mode

- Never jump from the first plausible search result directly to an edit.
- Search the repository and read the target implementation plus at least one related caller/callee/test/configuration/similar implementation.
- Before modifying repository files, call `engineering_guard_analysis`.
- Use exact file paths from files actually read as evidence sources.
- If modification is blocked, satisfy the missing requirements autonomously and retry.
- Do not ask the user for approval to investigate, read related files, inspect references, review diffs, run normal tests, compile, lint, or continue internal verification.
- After modifying repository files, inspect `git diff`, run targeted validation, then call `engineering_guard_verification`.
- Do not claim a validation command ran unless it actually ran.
- Prefer minimal root-cause fixes and avoid unrelated refactoring.

## Failure escalation

The plugin automatically escalates after repeated failed validation or repeated rejected verification.

When failure escalation is active:

1. Stop repeating the previous patch.
2. Return to investigation.
3. Perform additional searches.
4. Inspect additional related files/code paths.
5. Re-evaluate the previous root cause.
6. Submit a stronger `engineering_guard_analysis`.
7. Explain why the previous attempt failed.
8. Check more than one alternative root cause.
9. Call `engineering_guard_critic`.
10. Only modify again if the critic verdict is `accept`.

The critic should actively challenge:
- unsupported assumptions
- alternate root causes
- missed callers/code paths
- regression risks
- contradictions with observed behavior

If the critic verdict is `revise`, return to investigation and submit a revised analysis.

Failure escalation is automatic. Do not ask the user whether escalation should happen.

Only ask the user when required information genuinely cannot be discovered from the repository, environment, tools, or conversation.
