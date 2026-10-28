# Installe Rushlight dans Premiere Pro (utilisateur courant).
$ErrorActionPreference = 'Stop'

$source = $PSScriptRoot
$target = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.rushlight'

# Autorise les extensions non signées (nécessaire pour une extension perso).
# Les versions de CEP à venir sont incluses d'avance, pour les prochaines versions de Premiere.
foreach ($v in 9..20) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-ItemProperty -Path $key -Name 'PlayerDebugMode' -Value '1' -Type String
}

if (Test-Path $target) { Remove-Item $target -Recurse -Force }
New-Item -ItemType Directory -Path $target -Force | Out-Null

# Ancien nom de l'extension (avant la v0.8.0) : on le retire pour ne pas avoir deux panneaux
$old = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.autocutlite'
if (Test-Path $old) { Remove-Item $old -Recurse -Force; Write-Host "Ancienne version retirée / Previous version removed." }

# Premiere 2025+ ignore PlayerDebugMode : on installe la version signée (Rushlight.zxp) si elle existe.
# Après toute modification du code, il faut re-signer le .zxp, sinon Premiere refuse de charger le panneau.
$zxp = Join-Path $source 'Rushlight.zxp'
if (Test-Path $zxp) {
    $zip = Join-Path $env:TEMP 'Rushlight.zip'
    Copy-Item $zxp $zip -Force
    Expand-Archive $zip -DestinationPath $target -Force
    Remove-Item $zip
} else {
    Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force -Exclude 'install.ps1', 'install.bat', 'README.md'
    Copy-Item -Path (Join-Path $source '.debug') -Destination $target -Force
}

Write-Host "Rushlight installé / installed: $target" -ForegroundColor Green

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -and
    -not (Test-Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe')) -and
    -not (Test-Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\Gyan.FFmpeg*\*\bin\ffmpeg.exe'))) {
    Write-Host ""
    Write-Host "ffmpeg n'est pas installé / ffmpeg is not installed:" -ForegroundColor Yellow
    Write-Host "  winget install Gyan.FFmpeg"
    Write-Host "(ou / or: ffmpeg.exe -> $target\bin\)"
}

Write-Host ""
Write-Host "Redémarrez Premiere Pro : Fenêtre > Extensions > Rushlight"
Write-Host "Restart Premiere Pro: Window > Extensions > Rushlight"
