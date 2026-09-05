import { tool, type Plugin } from "@opencode-ai/plugin"

type Alternative = {
  hypothesis: string
  result: string
}

type Evidence = {
  source: string
  finding: string
}

type ValidationResult = {
  command: string
  result: string
}

type GuardMode = "strict" | "generation"

type SessionState = {
  mode: GuardMode
  generationPlanAccepted: boolean
  searchesPerformed: number
  filesRead: Set<string>

  analysisAccepted: boolean
  criticAccepted: boolean

  modificationStarted: boolean
  modifiedFiles: Set<string>

  diffReviewed: boolean
  validationCommands: string[]
  failedValidationCommands: string[]

  verificationAccepted: boolean
  verificationRejects: number

  policyBlocks: number

  escalationLevel: number
  escalationReason?: string

  startedAt: number
}

const POLICY_TEXT = `
ENGINEERING GUARD IS ACTIVE.

For every non-trivial repository change, you MUST use this autonomous workflow:

RESEARCH -> ANALYZE -> VERIFY HYPOTHESIS -> IMPLEMENT -> REVIEW DIFF -> VALIDATE -> VERIFY RESULT -> FINISH

Mandatory rules:

TASK PROFILES:

- BUG FIX / REFACTOR / BEHAVIOR CHANGE: use the strict analysis workflow.
- TEST CASE / TEST SCRIPT / AUTOMATION SCRIPT GENERATION: use engineering_guard_generation_plan after inspecting the repository format and source information.

For generation tasks, do NOT invent a fake root cause just to satisfy the guard.
Once engineering_guard_generation_plan is accepted, batch file creation/editing is unlocked for the whole current task.
Do not repeat the generation gate for every generated file.
Failure escalation is disabled for normal test/script generation because individual generated tests may legitimately fail during discovery.

1. Do not modify repository files immediately after the first plausible search result.
2. Before modification, inspect the target implementation and at least one related caller, callee, test, configuration, or similar implementation.
3. Perform at least one relevant repository search/reference lookup.
4. Before edit/write/patch or a modifying shell command, call engineering_guard_analysis.
5. The analysis must identify:
   - probable root cause / technical explanation
   - at least two evidence items from files actually read in this session
   - at least one plausible alternative explanation that was checked
   - affected areas
   - proposed change
6. If a modification is blocked, DO NOT ask the user for permission. Satisfy the missing requirements autonomously and retry.
7. After any repository modification:
   - inspect git diff
   - run the most relevant available test/build/compile/lint/typecheck
   - call engineering_guard_verification
8. Do not claim tests ran unless they actually ran.
9. Do not ask the user whether you should inspect files, search references, review the diff, run normal tests, compile, lint, or continue internal verification. Do these autonomously.
10. Only ask the user when required information genuinely cannot be discovered from the repository, environment, tools, or conversation.
11. If validation fails, reconsider the root cause instead of repeatedly patching the same assumption.
12. Keep changes minimal and avoid unrelated refactoring.

AUTONOMOUS DIAGNOSIS:

When a test, API call, build, compile, lint, script, or reproduction attempt fails:
- inspect the failure output before changing code
- first ask internally: "How can I reproduce or isolate this myself?"
- try at least one focused diagnostic step using available tools
- prefer the smallest reproducible command/request/test
- inspect logs, request/response bodies, status codes, stack traces, relevant state, and nearby code when useful
- use curl/HTTPie/Invoke-RestMethod/diagnostic commands when appropriate
- you may create temporary diagnostic probes under .opencode/engineering-guard/probes/ before the normal modification gate is unlocked
- do not treat temporary probes as the product fix
- clean up temporary probes when they are no longer useful
- only ask the user after autonomous diagnosis when user-only information, credentials, external state, business intent, or an unavailable environment is genuinely required
- if asking the user, ask one targeted question and include what you already tried and what evidence is missing

The guard should facilitate testing and diagnosis, not prevent it.

FAILURE ESCALATION:

If repeated validation or verification failures occur, the guard automatically escalates the task.

When escalation is active:
- return to investigation
- perform additional searches
- inspect more related files
- submit a stronger engineering_guard_analysis
- call engineering_guard_critic before modifying again
- explicitly challenge the previous root cause and proposed fix
- do not repeat the same patch without new evidence

The user does not need to request escalation manually.

IMPORTANT:
- engineering_guard_analysis unlocks repository modification only when runtime-observed investigation is sufficient.
- after escalation, engineering_guard_critic must also pass before repository modification is unlocked.
- engineering_guard_verification records post-change verification only when runtime-observed diff review and validation are sufficient.
- Use exact file paths previously read when citing evidence sources.
`

const sessions = new Map<string, SessionState>()

function freshState(): SessionState {
  return {
    mode: "strict",
    generationPlanAccepted: false,
    searchesPerformed: 0,
    filesRead: new Set<string>(),

    analysisAccepted: false,
    criticAccepted: false,

    modificationStarted: false,
    modifiedFiles: new Set<string>(),

    diffReviewed: false,
    validationCommands: [],
    failedValidationCommands: [],

    verificationAccepted: false,
    verificationRejects: 0,

    policyBlocks: 0,

    escalationLevel: 0,

    startedAt: Date.now(),
  }
}

function stateFor(sessionID: string): SessionState {
  let state = sessions.get(sessionID)
  if (!state) {
    state = freshState()
    sessions.set(sessionID, state)
  }
  return state
}

function resetSession(sessionID: string) {
  sessions.set(sessionID, freshState())
}

function normalizePath(value: string): string {
  let v = String(value ?? "").trim().replace(/\\/g, "/")
  v = v.replace(/#L\d+(?:-L?\d+)?$/i, "")
  v = v.replace(/:\d+(?:-\d+)?$/, "")
  v = v.replace(/^["'`]|["'`]$/g, "")
  v = v.replace(/\/+/g, "/")
  return v.toLowerCase()
}

function sourceMatchesRead(source: string, filesRead: Set<string>): boolean {
  const s = normalizePath(source)
  if (!s) return false

  for (const file of filesRead) {
    const f = normalizePath(file)
    if (!f) continue
    if (s === f || s.endsWith("/" + f) || f.endsWith("/" + s) || s.includes(f)) {
      return true
    }
  }
  return false
}

function toolName(input: any): string {
  return String(input?.tool ?? "").trim().toLowerCase()
}

function shellCommand(args: any): string {
  return String(args?.command ?? args?.cmd ?? args?.script ?? "").trim()
}

function exitCodeOf(output: any): number | undefined {
  const raw =
    output?.metadata?.exitCode ??
    output?.metadata?.exit ??
    output?.metadata?.code ??
    output?.exitCode ??
    output?.exit

  if (raw === undefined || raw === null) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function isSuccessful(output: any): boolean {
  const exitCode = exitCodeOf(output)
  return exitCode === undefined || exitCode === 0
}

const DIRECT_MODIFICATION_TOOLS = new Set([
  "edit",
  "write",
  "patch",
  "apply_patch",
  "applypatch",
])

const SEARCH_TOOLS = new Set([
  "grep",
  "glob",
  "lsp",
])

const READ_TOOLS = new Set([
  "read",
])

const SHELL_TOOLS = new Set([
  "bash",
  "shell",
])

function isGitDiff(command: string): boolean {
  return /(^|[;&|]\s*)git\s+diff(?:\s|$)/i.test(command)
}

function isValidationCommand(command: string): boolean {
  const c = command.toLowerCase()

  const patterns = [
    /\bpytest\b/,
    /\bpython(?:3)?\s+-m\s+pytest\b/,
    /\bunittest\b/,
    /\bnpm\s+(?:run\s+)?test\b/,
    /\bnpm\s+run\s+(?:build|lint|typecheck|check)\b/,
    /\bnpx\s+(?:tsc|eslint|vitest|jest)\b/,
    /\bpnpm\s+(?:test|build|lint|typecheck|check)\b/,
    /\bpnpm\s+run\s+(?:test|build|lint|typecheck|check)\b/,
    /\byarn\s+(?:test|build|lint|typecheck|check)\b/,
    /\bbun\s+(?:test|run\s+(?:test|build|lint|typecheck|check))\b/,
    /\bmvn(?:w)?(?:\.cmd)?\s+.*\b(?:test|verify|package|compile)\b/,
    /\bgradle(?:w)?(?:\.bat)?\s+.*\b(?:test|check|build|compile\w*)\b/,
    /\bdotnet\s+(?:test|build)\b/,
    /\bcargo\s+(?:test|check|clippy|build)\b/,
    /\bgo\s+(?:test|vet|build)\b/,
    /\btsc\b/,
    /\beslint\b/,
    /\bruff\b/,
    /\bflake8\b/,
    /\bmypy\b/,
    /\bpyright\b/,
    /\bjavac\b/,
  ]

  return patterns.some((pattern) => pattern.test(c))
}

function isKnownReadOnlyShell(command: string): boolean {
  const c = command.trim()
  if (!c) return true

  const patterns = [
    /^git\s+(?:status|diff|log|show|branch|rev-parse|ls-files|grep)(?:\s|$)/i,
    /^(?:rg|grep|findstr|where|which|type|cat|head|tail|less|more)\b/i,
    /^(?:ls|dir|pwd|cd)(?:\s|$)/i,
    /^Get-(?:Content|ChildItem|Location|Item|Command)\b/i,
    /^Select-String\b/i,
    /^Test-Path\b/i,
  ]

  return patterns.some((pattern) => pattern.test(c))
}

function isKnownModifyingShell(command: string): boolean {
  const c = command.trim()
  if (!c) return false

  const patterns = [
    /(^|[;&|]\s*)(?:rm|rmdir|del|erase|mv|move|cp|copy)\b/i,
    /(^|[;&|]\s*)(?:Remove-Item|Move-Item|Copy-Item|Rename-Item|Set-Content|Add-Content|Out-File|New-Item)\b/i,
    /\bsed\s+-[^\s]*i\b/i,
    /\bperl\s+-[^\s]*pi\b/i,
    /(^|[^>])>{1,2}(?![&])/,
    /\bgit\s+(?:add|commit|reset|restore|checkout|switch|clean|apply|merge|rebase|cherry-pick|revert|stash|am)(?:\s|$)/i,
    /\bnpm\s+(?:install|i|uninstall|remove|update)(?:\s|$)/i,
    /\bpnpm\s+(?:install|add|remove|update)(?:\s|$)/i,
    /\byarn\s+(?:install|add|remove|upgrade)(?:\s|$)/i,
    /\bbun\s+(?:install|add|remove|update)(?:\s|$)/i,
    /\bpip(?:3)?\s+install(?:\s|$)/i,
    /\bpython(?:3)?\s+-c\b.*\b(?:write|write_text|write_bytes|unlink|rename|replace|mkdir)\b/i,
    /\bnode\s+-e\b.*\b(?:writeFile|writeFileSync|unlink|rename|mkdir)\b/i,
    /(?:^|\s)(?:curl|curl\.exe)\b.*(?:\s-o\s|\s--output(?:=|\s)|\s-O(?:\s|$)|\s--remote-name(?:\s|$))/i,
    /(?:^|\s)(?:Invoke-WebRequest|iwr)\b.*(?:-OutFile\s+)/i,
  ]

  return patterns.some((pattern) => pattern.test(c))
}

function isDiagnosticCommand(command: string): boolean {
  const c = command.trim()
  if (!c) return false

  // These commands are intended for reproduction, inspection, connectivity checks,
  // API probing, or running an existing diagnostic/test script. Explicit file-writing
  // forms are filtered by isKnownModifyingShell before this function is consulted.
  const patterns = [
    /^(?:curl|curl\.exe)(?:\s|$)/i,
    /^(?:http|https|httpie)(?:\s|$)/i,
    /^Invoke-(?:WebRequest|RestMethod)\b/i,
    /^Test-NetConnection\b/i,
    /^(?:ping|ping\.exe|tracert|traceroute|nslookup)(?:\s|$)/i,
    /^Resolve-DnsName\b/i,
    /^Get-NetTCPConnection\b/i,
    /^(?:netstat|ss|lsof)(?:\s|$)/i,
    /^openssl\s+s_client\b/i,
    /^docker\s+(?:logs|ps|inspect)(?:\s|$)/i,
    /^kubectl\s+(?:get|describe|logs|explain|api-resources|api-versions)(?:\s|$)/i,
    /^(?:py|python|python3)\s+(?!-c\b)[^\s]+\.py(?:\s|$)/i,
    /^node\s+(?!-e\b)[^\s]+\.(?:js|cjs|mjs)(?:\s|$)/i,
    /^java\s+(?:-jar\s+)?[^\s]+(?:\s|$)/i,
  ]

  return patterns.some((pattern) => pattern.test(c))
}

const DIAGNOSTIC_PATH_FRAGMENTS = [
  "/.opencode/engineering-guard/probes/",
  "/.opencode/engineering_guard/probes/",
  "/.opencode/probes/",
]

function isDiagnosticTempPath(value: string | undefined): boolean {
  if (!value) return false
  const normalized = "/" + normalizePath(value).replace(/^\/+/, "")
  return DIAGNOSTIC_PATH_FRAGMENTS.some((fragment) => normalized.includes(fragment))
}

function patchPaths(patchText: string): string[] {
  const paths: string[] = []
  const regex = /^\*\*\* (?:Add File|Update File|Delete File|Move to):\s*(.+)$/gim
  let match: RegExpExecArray | null
  while ((match = regex.exec(patchText)) !== null) {
    if (match[1]?.trim()) paths.push(match[1].trim())
  }
  return paths
}

function directModificationIsDiagnosticProbe(tool: string, args: any): boolean {
  if (tool === "apply_patch" || tool === "applypatch" || tool === "patch") {
    const text = String(args?.patchText ?? args?.patch ?? "")
    const paths = patchPaths(text)
    return paths.length > 0 && paths.every((path) => isDiagnosticTempPath(path))
  }

  return isDiagnosticTempPath(filePathFromArgs(args))
}

function diagnosticFailureGuidance(command: string): string {
  return [
    "ENGINEERING GUARD: DIAGNOSTIC FAILURE OBSERVED",
    "",
    `The attempted diagnostic/validation command failed: ${command}`,
    "",
    "Before asking the user or changing code:",
    "1. Inspect the failure output/status/stack trace/request-response details.",
    "2. Decide how to reproduce or isolate the failure with the smallest focused test.",
    "3. Try at least one autonomous diagnostic step using available tools.",
    "4. Inspect relevant logs/state/code if the result is still ambiguous.",
    "5. Change code only when evidence supports the diagnosis.",
    "",
    "You may use curl, HTTPie, Invoke-RestMethod, network/log inspection, existing test runners, or a temporary probe under .opencode/engineering-guard/probes/.",
    "Only ask the user if information unavailable to the environment is genuinely required. If you ask, state what you already tried and exactly what information is missing.",
  ].join("\n")
}

/**
 * Before analysis, unknown shell commands are conservatively treated as potentially
 * modifying. Read-only, validation, and diagnostic commands remain available so the
 * agent can reproduce and investigate failures before deciding on a code change.
 */
function shellNeedsModificationUnlock(command: string): boolean {
  if (!command.trim()) return false
  if (isKnownModifyingShell(command)) return true
  if (isKnownReadOnlyShell(command)) return false
  if (isValidationCommand(command)) return false
  if (isDiagnosticCommand(command)) return false
  return true
}

function filePathFromArgs(args: any): string | undefined {
  const value =
    args?.filePath ??
    args?.path ??
    args?.file ??
    args?.filename

  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function isGenerationMode(state: SessionState): boolean {
  return state.mode === "generation"
}

function requiredSearches(state: SessionState): number {
  return state.escalationLevel > 0 ? 2 : 1
}

function requiredFiles(state: SessionState): number {
  return state.escalationLevel > 0 ? 3 : 2
}

function requiredEvidenceSources(state: SessionState): number {
  return state.escalationLevel > 0 ? 3 : 2
}

function requiredAlternatives(state: SessionState): number {
  return state.escalationLevel > 0 ? 2 : 1
}

function triggerEscalation(state: SessionState, reason: string): boolean {
  if (state.escalationLevel > 0) return false

  state.escalationLevel = 1
  state.escalationReason = reason

  // A repeated failure invalidates the previous diagnosis.
  state.analysisAccepted = false
  state.criticAccepted = false
  state.verificationAccepted = false

  return true
}

function missingInvestigation(state: SessionState): string[] {
  const missing: string[] = []

  if (isGenerationMode(state)) {
    if (!state.generationPlanAccepted) {
      missing.push("call engineering_guard_generation_plan after inspecting source information and repository test/script format")
    }
    return missing
  }

  if (state.searchesPerformed < requiredSearches(state)) {
    missing.push(
      `perform at least ${requiredSearches(state)} relevant repository search/reference lookup(s)`,
    )
  }

  if (state.filesRead.size < requiredFiles(state)) {
    missing.push(
      `read at least ${requiredFiles(state)} relevant files including target and related caller/callee/test/configuration`,
    )
  }

  if (!state.analysisAccepted) {
    missing.push("call engineering_guard_analysis with evidence from files actually read")
  }

  if (state.escalationLevel > 0 && !state.criticAccepted) {
    missing.push("call engineering_guard_critic and pass the escalated critic review")
  }

  return missing
}

function modificationBlockedMessage(state: SessionState): string {
  const missing = missingInvestigation(state)

  const lines = [
    "ENGINEERING POLICY: MODIFICATION BLOCKED",
    "",
    "You attempted to modify the repository before the mandatory investigation was completed.",
  ]

  if (state.escalationLevel > 0) {
    lines.push(
      "",
      "FAILURE ESCALATION IS ACTIVE.",
      `Reason: ${state.escalationReason ?? "repeated failed attempts"}`,
      "",
      "Do not repeat the previous patch without new evidence.",
      "Return to investigation, inspect additional code paths, strengthen the analysis, and complete the critic pass.",
    )
  }

  lines.push(
    "",
    "Missing requirements:",
    ...missing.map((item) => `- ${item}`),
    "",
    "Continue autonomously using read/grep/glob/LSP/read-only shell tools.",
    "Do NOT ask the user for permission.",
    "If this task is test-case, test-script, or automation-script generation, use engineering_guard_generation_plan instead of inventing a bug root cause.",
  )

  if (state.escalationLevel > 0) {
    lines.push(
      "After the stronger analysis is accepted, call engineering_guard_critic before retrying modification.",
    )
  } else {
    lines.push(
      "After the requirements are satisfied, call engineering_guard_analysis and retry the modification.",
    )
  }

  return lines.join("\n")
}

function commandComparable(command: string): string {
  return command.trim().replace(/\s+/g, " ").toLowerCase()
}

function validationWasObserved(command: string, observed: string[]): boolean {
  const c = commandComparable(command)
  return observed.some((item) => {
    const o = commandComparable(item)
    return c === o || c.includes(o) || o.includes(c)
  })
}

export const EngineeringGuardPlugin: Plugin = async ({ client }) => {
  const env = (globalThis as any)?.process?.env ?? {}
  if (env.OPENCODE_ENGINEERING_GUARD === "0") {
    return {}
  }

  const log = async (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    extra?: Record<string, unknown>,
  ) => {
    try {
      await client.app.log({
        body: {
          service: "engineering-guard",
          level,
          message,
          extra,
        },
      })
    } catch {
      // Logging must never break the agent.
    }
  }

  await log("info", "Engineering guard initialized", {
    mode: "strict",
    failureEscalation: true,
  })

  return {
    /**
     * A new user message starts a fresh guarded engineering task for this session.
     */
    "chat.message": async (input) => {
      if (!input?.sessionID) return
      resetSession(input.sessionID)
      await log("debug", "POLICY task reset", {
        sessionID: input.sessionID,
      })
    },

    /**
     * Inject the operating protocol into every model, globally.
     * Merge into the first system block to avoid multiple-system-message issues
     * with some OpenAI-compatible providers.
     */
    "experimental.chat.system.transform": async (input, output) => {
      if (!Array.isArray(output.system)) return

      if (output.system.length === 0) {
        output.system.push(POLICY_TEXT)
        return
      }

      if (!output.system[0].includes("ENGINEERING GUARD IS ACTIVE")) {
        output.system.splice(0, 1, `${output.system[0]}\n\n${POLICY_TEXT}`)
      }
    },

    /**
     * Hard pre-execution gate.
     */
    "tool.execute.before": async (input, output) => {
      const name = toolName(input)
      const state = stateFor(input.sessionID)

      let requiresUnlock = DIRECT_MODIFICATION_TOOLS.has(name)

      if (requiresUnlock && directModificationIsDiagnosticProbe(name, output?.args)) {
        await log("debug", "POLICY diagnostic probe write allowed", {
          sessionID: input.sessionID,
          tool: name,
          path: filePathFromArgs(output?.args),
        })
        return
      }

      if (SHELL_TOOLS.has(name)) {
        const command = shellCommand(output?.args)
        requiresUnlock = shellNeedsModificationUnlock(command)
      }

      if (!requiresUnlock) return

      const missing = missingInvestigation(state)
      if (missing.length > 0) {
        state.policyBlocks += 1

        await log("warn", "POLICY modification blocked", {
          sessionID: input.sessionID,
          tool: name,
          searchesPerformed: state.searchesPerformed,
          filesRead: state.filesRead.size,
          analysisAccepted: state.analysisAccepted,
          criticAccepted: state.criticAccepted,
          escalationLevel: state.escalationLevel,
          policyBlocks: state.policyBlocks,
        })

        throw new Error(modificationBlockedMessage(state))
      }
    },

    /**
     * Observe tool execution. Successful investigation is tracked, while failed
     * validation attempts contribute to automatic failure escalation.
     */
    "tool.execute.after": async (input, output) => {
      const name = toolName(input)
      const state = stateFor(input.sessionID)
      const args = input?.args ?? {}

      if (READ_TOOLS.has(name) && isSuccessful(output)) {
        const path = filePathFromArgs(args)
        if (path) {
          state.filesRead.add(path)
        }
      }

      if (SEARCH_TOOLS.has(name) && isSuccessful(output)) {
        state.searchesPerformed += 1
      }

      if (SHELL_TOOLS.has(name)) {
        const command = shellCommand(args)

        if (isGitDiff(command) && isSuccessful(output)) {
          state.diffReviewed = true
          await log("debug", "POLICY diff reviewed", {
            sessionID: input.sessionID,
            command,
          })
        }

        const diagnosticOrValidation = isValidationCommand(command) || isDiagnosticCommand(command)

        if (diagnosticOrValidation) {
          if (isSuccessful(output)) {
            if (isValidationCommand(command)) {
              state.validationCommands.push(command)
            }

            await log("debug", isValidationCommand(command) ? "POLICY validation observed" : "POLICY diagnostic observed", {
              sessionID: input.sessionID,
              command,
            })
          } else {
            if (isValidationCommand(command)) {
              state.failedValidationCommands.push(command)
            }

            await log("warn", isValidationCommand(command) ? "POLICY validation failed" : "POLICY diagnostic failed", {
              sessionID: input.sessionID,
              command,
              failedValidationCount: state.failedValidationCommands.length,
              exitCode: exitCodeOf(output),
            })

            // Native tool results can be annotated so the next model turn is explicitly
            // pushed toward autonomous reproduction/isolation rather than immediately
            // asking the user or guessing a patch. Keep both output and metadata.output
            // in sync for OpenCode versions whose TUI uses either field.
            const guidance = diagnosticFailureGuidance(command)
            if (typeof output?.output === "string" && !output.output.includes("DIAGNOSTIC FAILURE OBSERVED")) {
              output.output = `${output.output}\n\n${guidance}`
            }
            if (typeof output?.metadata?.output === "string" && !output.metadata.output.includes("DIAGNOSTIC FAILURE OBSERVED")) {
              output.metadata.output = `${output.metadata.output}\n\n${guidance}`
            }

            if (isValidationCommand(command) && !isGenerationMode(state) && state.failedValidationCommands.length >= 2) {
              const escalated = triggerEscalation(
                state,
                "Two or more validation commands failed during the current task.",
              )

              if (escalated) {
                await log("warn", "POLICY failure escalation activated", {
                  sessionID: input.sessionID,
                  reason: state.escalationReason,
                })
              }
            }
          }
        }

        if (isKnownModifyingShell(command) && isSuccessful(output)) {
          state.modificationStarted = true
          state.modifiedFiles.add(`[shell] ${command}`)

          state.diffReviewed = false
          state.validationCommands = []
          state.verificationAccepted = false
        }
      }

      if (DIRECT_MODIFICATION_TOOLS.has(name) && isSuccessful(output)) {
        if (directModificationIsDiagnosticProbe(name, args)) {
          await log("debug", "POLICY diagnostic probe written", {
            sessionID: input.sessionID,
            tool: name,
            path: filePathFromArgs(args),
          })
          return
        }

        state.modificationStarted = true

        const path = filePathFromArgs(args)
        if (path) state.modifiedFiles.add(path)

        // Any new change invalidates previous post-change verification.
        state.diffReviewed = false
        state.validationCommands = []
        state.verificationAccepted = false
      }
    },

    tool: {
      engineering_guard_generation_plan: tool({
        description:
          "Use for test-case, test-script, automation-script, fixture, or similar generation tasks. After inspecting repository conventions and source information, this unlocks batch generation without requiring bug-style root-cause analysis for every file.",
        args: {
          task_type: tool.schema.enum([
            "test_case_generation",
            "test_script_generation",
            "automation_script_generation",
            "fixture_generation",
          ]),
          target_scope: tool.schema.string().min(3),
          source_files: tool.schema
            .array(tool.schema.string().min(1))
            .min(2)
            .describe("Exact paths of source/info/framework files actually read in this session."),
          repository_format_understood: tool.schema.string().min(10),
          cleanup_scope: tool.schema.string().optional(),
          generation_plan: tool.schema.array(tool.schema.string().min(3)).min(1),
          validation_plan: tool.schema.array(tool.schema.string().min(3)).min(1),
        },
        async execute(args, context) {
          const state = stateFor(context.sessionID)
          const problems: string[] = []

          if (state.searchesPerformed < 1) {
            problems.push("At least one repository search/reference lookup is required before generation.")
          }

          if (state.filesRead.size < 2) {
            problems.push("Read at least two relevant files: source/info plus repository format/runner/reference implementation.")
          }

          const matchedSources = args.source_files.filter((source: string) =>
            sourceMatchesRead(source, state.filesRead),
          )
          const uniqueSources = new Set(matchedSources.map((source: string) => normalizePath(source)))

          if (uniqueSources.size < 2) {
            problems.push("source_files must reference at least two distinct files actually read in this session.")
          }

          if (problems.length > 0) {
            return [
              "ENGINEERING POLICY: GENERATION PLAN REJECTED",
              "",
              ...problems.map((problem) => `- ${problem}`),
              "",
              "Continue inspecting the repository autonomously and retry.",
              "Do not ask the user for permission.",
            ].join("\n")
          }

          state.mode = "generation"
          state.generationPlanAccepted = true
          state.analysisAccepted = true
          state.criticAccepted = true
          state.escalationLevel = 0
          state.escalationReason = undefined

          await log("info", "POLICY generation mode unlocked", {
            sessionID: context.sessionID,
            taskType: args.task_type,
            targetScope: args.target_scope,
            cleanupScope: args.cleanup_scope,
            sourceFiles: [...uniqueSources],
          })

          return [
            "ENGINEERING POLICY: GENERATION MODE UNLOCKED",
            "",
            "Batch test/script generation is now unlocked for the current task.",
            "You may clean only the declared target scope and then create/edit all required generated files without repeating this gate per file.",
            "Do not perform bug-style root-cause analysis unless a real implementation defect is discovered.",
            "Validate the generated output at the end using the declared validation plan.",
          ].join("\n")
        },
      }),

      engineering_guard_analysis: tool({
        description:
          "MANDATORY before repository modification. Submit an evidence-backed analysis after searching and reading relevant code. During failure escalation, stricter evidence requirements apply.",
        args: {
          root_cause: tool.schema
            .string()
            .min(10)
            .describe("Most likely root cause or technical explanation."),
          evidence: tool.schema
            .array(
              tool.schema.object({
                source: tool.schema
                  .string()
                  .min(1)
                  .describe("Exact file path previously read in this session."),
                finding: tool.schema
                  .string()
                  .min(5)
                  .describe("Concrete finding from that source."),
              }),
            )
            .min(2),
          alternatives_checked: tool.schema
            .array(
              tool.schema.object({
                hypothesis: tool.schema.string().min(5),
                result: tool.schema.string().min(5),
              }),
            )
            .min(1),
          affected_areas: tool.schema.array(tool.schema.string().min(1)).min(1),
          proposed_change: tool.schema.string().min(10),
          risks: tool.schema.array(tool.schema.string()).default([]),
          previous_attempt_failure: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const state = stateFor(context.sessionID)
          state.mode = "strict"
          state.generationPlanAccepted = false
          const problems: string[] = []

          const minSearches = requiredSearches(state)
          const minFiles = requiredFiles(state)
          const minEvidence = requiredEvidenceSources(state)
          const minAlternatives = requiredAlternatives(state)

          if (state.searchesPerformed < minSearches) {
            problems.push(
              `Only ${state.searchesPerformed} successful search/reference lookup(s) were observed; ${minSearches} required.`,
            )
          }

          if (state.filesRead.size < minFiles) {
            problems.push(
              `Only ${state.filesRead.size} unique file(s) were read; ${minFiles} required.`,
            )
          }

          const matchingEvidence = args.evidence.filter((item: Evidence) =>
            sourceMatchesRead(item.source, state.filesRead),
          )

          const uniqueEvidenceSources = new Set(
            matchingEvidence.map((item: Evidence) => normalizePath(item.source)),
          )

          if (
            matchingEvidence.length < minEvidence ||
            uniqueEvidenceSources.size < minEvidence
          ) {
            problems.push(
              `At least ${minEvidence} evidence items must reference ${minEvidence} distinct files actually read in this session.`,
            )
          }

          if (args.alternatives_checked.length < minAlternatives) {
            problems.push(
              `At least ${minAlternatives} plausible alternative explanation(s) must be checked.`,
            )
          }

          if (state.escalationLevel > 0) {
            const previousFailure = String(args.previous_attempt_failure ?? "").trim()
            if (previousFailure.length < 10) {
              problems.push(
                "Failure escalation is active: previous_attempt_failure must explain why the earlier attempt or diagnosis failed.",
              )
            }
          }

          if (problems.length > 0) {
            await log("warn", "POLICY analysis rejected", {
              sessionID: context.sessionID,
              escalationLevel: state.escalationLevel,
              problems,
            })

            return [
              "ENGINEERING POLICY: ANALYSIS REJECTED",
              "",
              ...problems.map((problem) => `- ${problem}`),
              "",
              "Continue investigating autonomously. Do not ask the user for permission.",
            ].join("\n")
          }

          state.analysisAccepted = true

          if (state.escalationLevel > 0) {
            state.criticAccepted = false
          }

          await log("info", "POLICY analysis accepted", {
            sessionID: context.sessionID,
            escalationLevel: state.escalationLevel,
            searchesPerformed: state.searchesPerformed,
            filesRead: [...state.filesRead],
            evidenceSources: [...uniqueEvidenceSources],
          })

          if (state.escalationLevel > 0) {
            return [
              "ENGINEERING POLICY: ESCALATED ANALYSIS ACCEPTED",
              "",
              "Failure escalation remains active.",
              "Before modifying code, call engineering_guard_critic.",
              "The critic must challenge the revised diagnosis, inspect regression risk, and decide whether implementation is safe.",
            ].join("\n")
          }

          return [
            "ENGINEERING POLICY: ANALYSIS ACCEPTED",
            "",
            "Repository modification tools are now unlocked for this task.",
            "Implement the smallest correct change.",
            "After modification, inspect git diff, run relevant validation, and call engineering_guard_verification before finishing.",
          ].join("\n")
        },
      }),
      engineering_guard_critic: tool({
        description:
          "MANDATORY only when failure escalation is active. Perform an adversarial review of the revised analysis before modifying code again.",
        args: {
          weaknesses: tool.schema.array(tool.schema.string().min(5)).min(1),
          alternate_root_causes: tool.schema.array(tool.schema.string().min(5)).min(1),
          missed_areas_checked: tool.schema.array(tool.schema.string().min(1)).min(1),
          regression_risks: tool.schema.array(tool.schema.string().min(1)).min(1),
          verdict: tool.schema.string().min(5),
          verdict_reason: tool.schema.string().min(10),
        },
        async execute(args, context) {
          const state = stateFor(context.sessionID)
          const verdict = String(args.verdict ?? "").trim().toLowerCase()

          if (state.escalationLevel === 0) {
            return [
              "ENGINEERING POLICY: CRITIC NOT REQUIRED",
              "",
              "Failure escalation is not active for this task.",
            ].join("\n")
          }

          if (!state.analysisAccepted) {
            return [
              "ENGINEERING POLICY: CRITIC REJECTED",
              "",
              "Submit and pass the escalated engineering_guard_analysis first.",
            ].join("\n")
          }

          if (verdict !== "accept" && verdict !== "revise") {
            return [
              "ENGINEERING POLICY: CRITIC REJECTED",
              "",
              'verdict must be exactly "accept" or "revise".',
            ].join("\n")
          }

          if (verdict === "revise") {
            state.analysisAccepted = false
            state.criticAccepted = false

            await log("warn", "POLICY critic requested revision", {
              sessionID: context.sessionID,
              verdictReason: args.verdict_reason,
            })

            return [
              "ENGINEERING POLICY: CRITIC REQUIRES REVISION",
              "",
              args.verdict_reason,
              "",
              "Return to investigation and submit a revised engineering_guard_analysis.",
              "Do not modify the repository yet.",
            ].join("\n")
          }

          state.criticAccepted = true

          await log("info", "POLICY critic accepted", {
            sessionID: context.sessionID,
            escalationReason: state.escalationReason,
          })

          return [
            "ENGINEERING POLICY: CRITIC ACCEPTED",
            "",
            "The escalated diagnosis passed adversarial review.",
            "Repository modification is unlocked again.",
            "Implement the revised minimal fix, then review the diff and run targeted validation.",
          ].join("\n")
        },
      }),

      engineering_guard_verification: tool({
        description:
          "MANDATORY after repository modification and before declaring the task complete. The runtime verifies that git diff and claimed validation commands were actually observed.",
        args: {
          diff_reviewed: tool.schema.boolean(),
          validation_commands: tool.schema.array(tool.schema.string()).default([]),
          validation_results: tool.schema
            .array(
              tool.schema.object({
                command: tool.schema.string().min(1),
                result: tool.schema.string().min(1),
              }),
            )
            .default([]),
          validation_unavailable_reason: tool.schema.string().optional(),
          regression_risks: tool.schema.array(tool.schema.string()).default([]),
          remaining_uncertainties: tool.schema.array(tool.schema.string()).default([]),
          solution_confirmed: tool.schema.boolean(),
        },
        async execute(args, context) {
          const state = stateFor(context.sessionID)
          const problems: string[] = []

          if (!state.modificationStarted) {
            problems.push("No repository modification was observed in this task.")
          }

          if (!state.diffReviewed || !args.diff_reviewed) {
            problems.push("A successful git diff review was not observed after the latest modification.")
          }

          const claimed = args.validation_commands ?? []
          const unavailableReason = String(args.validation_unavailable_reason ?? "").trim()

          if (state.validationCommands.length === 0 && !unavailableReason) {
            problems.push(
              "No relevant test/build/compile/lint/typecheck command was observed. Run targeted validation or provide a concrete reason validation is unavailable.",
            )
          }

          for (const command of claimed) {
            if (!validationWasObserved(command, state.validationCommands)) {
              problems.push(
                `Claimed validation command was not observed by the runtime: ${command}`,
              )
            }
          }

          for (const item of args.validation_results as ValidationResult[]) {
            if (!validationWasObserved(item.command, state.validationCommands)) {
              problems.push(
                `Validation result references a command not observed by the runtime: ${item.command}`,
              )
            }
          }

          if (!args.solution_confirmed) {
            problems.push(
              "solution_confirmed is false. Re-investigate or fix remaining issues before verification.",
            )
          }

          if (problems.length > 0) {
            state.verificationRejects += 1

            if (!isGenerationMode(state) && state.verificationRejects >= 2) {
              const escalated = triggerEscalation(
                state,
                "Post-change verification was rejected two or more times.",
              )

              if (escalated) {
                await log("warn", "POLICY failure escalation activated", {
                  sessionID: context.sessionID,
                  reason: state.escalationReason,
                })
              }
            }

            await log("warn", "POLICY verification rejected", {
              sessionID: context.sessionID,
              verificationRejects: state.verificationRejects,
              escalationLevel: state.escalationLevel,
              problems,
            })

            const response = [
              "ENGINEERING POLICY: VERIFICATION REJECTED",
              "",
              ...problems.map((problem) => `- ${problem}`),
            ]

            if (state.escalationLevel > 0) {
              response.push(
                "",
                "FAILURE ESCALATION IS ACTIVE.",
                `Reason: ${state.escalationReason ?? "repeated verification failure"}`,
                "",
                "Return to investigation before modifying again.",
                "Gather new evidence, submit a stronger engineering_guard_analysis, then pass engineering_guard_critic.",
                "Do not repeat the same fix without new evidence.",
              )
            } else {
              response.push(
                "",
                "Continue autonomously. Fix or validate what is missing, then call engineering_guard_verification again.",
              )
            }

            response.push(
              "Do not ask the user for permission to perform normal engineering validation.",
            )

            return response.join("\n")
          }

          state.verificationAccepted = true

          await log("info", "POLICY verification accepted", {
            sessionID: context.sessionID,
            modifiedFiles: [...state.modifiedFiles],
            validationCommands: state.validationCommands,
            escalationLevel: state.escalationLevel,
          })

          return [
            "ENGINEERING POLICY: VERIFICATION ACCEPTED",
            "",
            "Post-change verification is complete.",
            "You may now provide the final response with root cause, changes, validation performed, and any remaining uncertainty.",
          ].join("\n")
        },
      }),
    },

    dispose: async () => {
      sessions.clear()
    },
  }
}

export default EngineeringGuardPlugin
