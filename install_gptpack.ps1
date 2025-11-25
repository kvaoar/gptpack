# ==========================================
#   GPTPACK INSTALLER — go-winres version
#   PNG → .syso → встроенные ресурсы
# ==========================================

$ErrorActionPreference = "Stop"

Write-Host "=== GPTPACK INSTALL START ==="

# ------------------------------------------
# Directories
# ------------------------------------------
$installDir = "C:\gptpack"
$uploadDir  = "C:\gpt_upload"

New-Item -ItemType Directory -Path $installDir -ErrorAction SilentlyContinue | Out-Null
New-Item -ItemType Directory -Path $uploadDir -ErrorAction SilentlyContinue | Out-Null

Write-Host "Install dir: $installDir"
Write-Host "Upload dir:  $uploadDir"

# ------------------------------------------
# Install Go automatically if missing
# ------------------------------------------
if (-not (Get-Command go.exe -ErrorAction SilentlyContinue)) {
    Write-Host "Go NOT FOUND. Installing Go..."

    $goMsi = "$env:TEMP\go.msi"
    Invoke-WebRequest -Uri "https://go.dev/dl/go1.22.0.windows-amd64.msi" -OutFile $goMsi
    Start-Process msiexec.exe -Wait -ArgumentList "/i `"$goMsi`" /qn"
}

if (-not (Get-Command go.exe -ErrorAction SilentlyContinue)) {
    Write-Host "Go install FAILED."
    exit 1
}

Write-Host "Go OK"


# ------------------------------------------
# Install go-winres (supports PNG)
# ------------------------------------------
if (-not (Get-Command go-winres.exe -ErrorAction SilentlyContinue)) {
    Write-Host "Installing go-winres..."
    go install github.com/tc-hib/go-winres@latest

    $goBin = "$env:USERPROFILE\go\bin"
    if (-not ($env:PATH -like "*$goBin*")) {
        $env:PATH += ";$goBin"
        Write-Host "Added Go bin path to PATH."
    }
}

if (-not (Get-Command go-winres.exe -ErrorAction SilentlyContinue)) {
    Write-Host "go-winres installation FAILED."
    exit 1
}

Write-Host "go-winres OK"


# ------------------------------------------
# Initialize Go module (if missing)
# ------------------------------------------
$root = $PSScriptRoot

if (-not (Test-Path "$root\go.mod")) {
    Write-Host "Initializing go.mod..."
    Push-Location $root
    go mod init gptpack
    go mod tidy
    Pop-Location
} else {
    Write-Host "go.mod already exists."
}

# ------------------------------------------
# RUN TESTS BEFORE BUILDING
# ------------------------------------------
Write-Host "Running go tests..."
Push-Location $root
go test
if ($LASTEXITCODE -ne 0) {
    Write-Host "TESTS FAILED. INSTALL ABORTED."
    exit 1
}
Pop-Location
Write-Host "Tests OK."

# ------------------------------------------
# Generate .syso from winres/winres.json
# ------------------------------------------
$winresJson = Join-Path $root "winres\winres.json"
if (!(Test-Path $winresJson)) {
    Write-Host "ERROR: winres.json not found."
    exit 1
}

Write-Host "Generating syso via go-winres..."
Push-Location $root
go-winres make --in winres/winres.json
Pop-Location

# Check that syso exists
$syso = Get-ChildItem $root -Filter "*.syso" | Select-Object -First 1

if ($syso -eq $null) {
    Write-Host "ERROR: No .syso file produced."
    exit 1
}

Write-Host "SYMBOLIC RESOURCE FILE GENERATED:"
Write-Host "  $($syso.FullName)"


# ------------------------------------------
# Build gptpack.exe with embedded resources
# ------------------------------------------
$src = Join-Path $root "gptpack.go"
$exe = Join-Path $installDir "gptpack.exe"

if (!(Test-Path $src)) {
    Write-Host "ERROR: gptpack.go not found."
    exit 1
}

Write-Host "Building gptpack.exe..."

Push-Location $root
go build -trimpath -ldflags "-H=windowsgui -s -w" -o $exe
Pop-Location

if (!(Test-Path $exe)) {
    Write-Host "BUILD FAILED."
    exit 1
}

Write-Host "Build OK: $exe"

# ------------------------------------------
# Copy config file
# ------------------------------------------
$configSrc = Join-Path $root "gptpack.config.json"
$configDst = Join-Path $installDir "gptpack.config.json"

if (Test-Path $configSrc) {
    Copy-Item $configSrc $configDst -Force
    Write-Host "Copied config: $configDst"
} else {
    Write-Host "WARNING: gptpack.config.json not found in project root!"
}


# ------------------------------------------
# Cleanup: remove generated syso and temp go.mod
# ------------------------------------------

# remove all syso files created by go-winres
Get-ChildItem $root -Filter "rsrc_windows_*.syso" | ForEach-Object {
    Remove-Item $_.FullName -Force
}

# remove go.mod and go.sum if they were created by installer
if (Test-Path "$root\go.mod") {
    Remove-Item "$root\go.mod" -Force
}
if (Test-Path "$root\go.sum") {
    Remove-Item "$root\go.sum" -Force
}

Write-Host "Cleanup OK"

Write-Host "=== INSTALL COMPLETE ==="
Write-Host 'Run: C:\gptpack\gptpack.exe <folder>'
