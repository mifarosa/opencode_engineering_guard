param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$ConfigDir = Join-Path $HOME ".config\opencode"
$PluginDir = Join-Path $ConfigDir "plugins"
$PluginTarget = Join-Path $PluginDir "engineering-guard.ts"
$AgentsTarget = Join-Path $ConfigDir "AGENTS.md"

$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PluginSource = Join-Path $SourceDir "engineering-guard.ts"
$AgentsSource = Join-Path $SourceDir "AGENTS.md"

if (-not (Test-Path $PluginSource)) {
    throw "engineering-guard.ts was not found next to this installer."
}

if (-not (Test-Path $AgentsSource)) {
    throw "AGENTS.md was not found next to this installer."
}

New-Item -ItemType Directory -Force $PluginDir | Out-Null

if (Test-Path $PluginTarget) {
    $backup = "$PluginTarget.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $PluginTarget $backup
    Write-Host "Existing plugin backed up to: $backup"
}

Copy-Item $PluginSource $PluginTarget -Force

if (Test-Path $AgentsTarget) {
    $existing = Get-Content $AgentsTarget -Raw
    $marker = "# Global Engineering Guard Instructions"
    $idx = $existing.IndexOf($marker)

    if ($idx -ge 0) {
        $before = $existing.Substring(0, $idx).TrimEnd()
        $guard = Get-Content $AgentsSource -Raw

        if ($before.Length -gt 0) {
            Set-Content -Path $AgentsTarget -Value ($before + "`r`n`r`n" + $guard) -Encoding UTF8
        } else {
            Set-Content -Path $AgentsTarget -Value $guard -Encoding UTF8
        }
    }
    else {
        $backup = "$AgentsTarget.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        Copy-Item $AgentsTarget $backup
        Write-Host "Existing AGENTS.md backed up to: $backup"

        $guard = Get-Content $AgentsSource -Raw
        Add-Content -Path $AgentsTarget -Value "`r`n`r`n$guard"
    }
}
else {
    Copy-Item $AgentsSource $AgentsTarget
}

Write-Host ""
Write-Host "Engineering Guard v4 installed globally."
Write-Host "Plugin: $PluginTarget"
Write-Host "Instructions: $AgentsTarget"
Write-Host "Failure escalation: ENABLED"
Write-Host ""
Write-Host "Quit OpenCode completely and start it again."
Write-Host ""
Write-Host "Emergency disable for the current PowerShell session:"
Write-Host '$env:OPENCODE_ENGINEERING_GUARD = "0"'
Write-Host ""
Write-Host "Re-enable:"
Write-Host 'Remove-Item Env:OPENCODE_ENGINEERING_GUARD -ErrorAction SilentlyContinue'
