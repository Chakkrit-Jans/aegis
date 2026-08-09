# Build Aegis Community (ce) and Enterprise (ee) Docker images from this one repo.
#   ce  = Enterprise overlay stripped out (public, free)
#   ee  = full build (private, license-gated)
# Usage:  pwsh scripts/build-images.ps1 [ce|ee|both]   (default: both)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$git = (git rev-parse --short HEAD)
$which = if ($args.Count -ge 1) { $args[0] } else { "both" }
$editions = if ($which -eq "both") { @("ce", "ee") } else { @($which) }

Write-Host "Building Aegis images (git $git): $($editions -join ', ')" -ForegroundColor Cyan
foreach ($ed in $editions) {
  Write-Host "== aegis-backend:$ed ==" -ForegroundColor Yellow
  docker build --build-arg EDITION=$ed --build-arg GIT_COMMIT=$git -t "aegis-backend:$ed" ./backend
  Write-Host "== aegis-frontend:$ed ==" -ForegroundColor Yellow
  docker build --build-arg EDITION=$ed -t "aegis-frontend:$ed" ./frontend
}
Write-Host "Done. Images:" -ForegroundColor Green
docker images --format "{{.Repository}}:{{.Tag}}`t{{.Size}}" | Select-String "aegis-(backend|frontend):(ce|ee)"
