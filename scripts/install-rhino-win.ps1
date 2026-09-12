[CmdletBinding()]
param(
    [switch]$Yes,
    [switch]$OpenRhino,
    [switch]$BuildOnly,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Help) {
    Write-Output @'
Build, verify, smoke-test, and install Hopper for Rhino 8 on Windows x64.
Requires stable Node 22.19.0+, pnpm, the .NET 8 SDK, and Rhino 8.20 or newer running .NET 8. Node is not bundled.

Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-rhino-win.ps1 [options]
  -Yes        Replace an existing hoppercode package without prompting.
  -OpenRhino  Open Rhino after installation.
  -BuildOnly  Build and smoke-test the Yak package without installing it.
  -Help       Show this help.

Close Rhino before installing. Set HOPPER_YAK to an absolute Yak.exe path
if Rhino 8 is installed in a custom location.
'@
    exit 0
}

function Invoke-Checked {
    param([string]$Command, [string[]]$CommandArgs)
    & $Command @CommandArgs
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}

function Assert-RhinoClosed {
    if (Get-Process -Name Rhino -ErrorAction SilentlyContinue) {
        throw 'Rhino is running. Close Rhino fully, then run this script again.'
    }
}

$previousSkip = [Environment]::GetEnvironmentVariable('HOPPER_SKIP_GH_PLUGIN', 'Process')
$previousYak = [Environment]::GetEnvironmentVariable('HOPPER_YAK', 'Process')
$pushed = $false
try {
    if ($env:OS -ne 'Windows_NT') { throw 'This installer only supports Windows.' }
    if ($BuildOnly -and $OpenRhino) { throw '-BuildOnly cannot be combined with -OpenRhino.' }
    foreach ($command in @('node', 'pnpm', 'dotnet')) {
        Get-Command $command -ErrorAction Stop | Out-Null
    }
    $nodeVersion = Invoke-Checked node @('--version')
    $nodeArch = Invoke-Checked node @('-p', 'process.arch')
    if ($nodeArch -ne 'x64' -or $nodeVersion -notmatch '^v(\d+)\.(\d+)\.(\d+)$') {
        throw 'Requires Windows x64 and stable Node 22.19.0 or newer.'
    }
    if ([version]$nodeVersion.Substring(1) -lt [version]'22.19.0') {
        throw "Requires stable Node 22.19.0 or newer; found $nodeVersion."
    }
    Invoke-Checked dotnet @('--version')
    $yak = if ($env:HOPPER_YAK) { $env:HOPPER_YAK } else { Join-Path $env:ProgramFiles 'Rhino 8\System\Yak.exe' }
    if (-not [IO.Path]::IsPathRooted($yak) -or -not (Test-Path -LiteralPath $yak -PathType Leaf)) {
        throw "Rhino 8 Yak was not found at $yak. Set HOPPER_YAK to its absolute executable path."
    }
    $env:HOPPER_YAK = $yak
    if (-not $BuildOnly) { Assert-RhinoClosed }
    Push-Location (Split-Path -Parent $PSScriptRoot)
    $pushed = $true
    $version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
    $stage = Join-Path $PWD "artifacts\hoppercode-$version-win-x64-local-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $stage | Out-Null

    Write-Host '[hoppercode] Installing JavaScript dependencies'
    $env:HOPPER_SKIP_GH_PLUGIN = '1'
    Invoke-Checked pnpm @('install', '--frozen-lockfile')
    Write-Host "[hoppercode] Building a fresh Rhino package at $stage"
    Invoke-Checked pnpm @('build', '--target', 'win-x64', '--output', $stage)
    Invoke-Checked node @('scripts/smoke-staged-host.mjs', $stage)
    if ($BuildOnly) {
        Write-Host "[hoppercode] Build and smoke test passed. Package files: $stage"
    } else {
        $installed = @(Invoke-Checked $yak @('list'))
        $existing = @($installed | Where-Object { $_ -match '^\s*(hoppercode|hopper-pi)\s+\(' })
        if ($existing.Count -gt 0 -and -not $Yes) {
            if ([Console]::IsInputRedirected) { throw 'hoppercode is already installed. Rerun with -Yes to replace it.' }
            $reply = Read-Host "$($existing -join ', ') is installed. Replace it? [y/N]"
            if ($reply -notmatch '^(?i:y|yes)$') {
                Write-Host "[hoppercode] Installation cancelled. Package files: $stage"
                return
            }
        }
        Assert-RhinoClosed
        Invoke-Checked node @('scripts/stop-shared-host.mjs')
        foreach ($entry in $existing) {
            $installedName = ($entry.Trim() -split '\s+')[0]
            Invoke-Checked $yak @('uninstall', $installedName)
        }
        Invoke-Checked $yak @('install', "--source=$stage", 'hoppercode', $version)
        $installed = @(Invoke-Checked $yak @('list'))
        $expected = '^\s*hoppercode\s+\(' + [regex]::Escape($version) + '\)'
        if (-not ($installed -match $expected)) { throw "Yak did not report hoppercode $version as installed." }
        Write-Host "[hoppercode] Installed hoppercode $version. Package files: $stage"
        Write-Host '[hoppercode] In Rhino, run HopperCode to start the new host and open the browser UI.'
        if ($OpenRhino) {
            Start-Process -FilePath (Join-Path (Split-Path -Parent $yak) 'Rhino.exe')
        }
    }
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    [Environment]::SetEnvironmentVariable('HOPPER_SKIP_GH_PLUGIN', $previousSkip, 'Process')
    [Environment]::SetEnvironmentVariable('HOPPER_YAK', $previousYak, 'Process')
    if ($pushed) { Pop-Location }
}
