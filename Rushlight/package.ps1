# Signe Rushlight puis prépare le ZIP de publication : dist\Rushlight-vX.Y.Z.zip
# (scripts d'installation + extension signée + licence), à joindre à une « release » GitHub.
$ErrorActionPreference = 'Stop'

$source = $PSScriptRoot
$root = Split-Path $source -Parent
$version = ([xml](Get-Content (Join-Path $source 'CSXS\manifest.xml') -Raw)).ExtensionManifest.ExtensionBundleVersion

& (Join-Path $source 'sign.ps1')

$dist = Join-Path $root 'dist'
$stage = Join-Path $dist "Rushlight-v$version"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($file in 'Rushlight.zxp', 'install.bat', 'install.ps1') { Copy-Item (Join-Path $source $file) $stage }
Copy-Item (Join-Path $root 'LICENSE') $stage
Set-Content (Join-Path $stage 'LISEZ-MOI - README.txt') -Encoding UTF8 -Value @"
Rushlight v$version

[FR] Fermez Premiere Pro, puis double-cliquez sur install.bat.
     ffmpeg est nécessaire : winget install Gyan.FFmpeg
     Ensuite : Fenêtre > Extensions > Rushlight.

[EN] Close Premiere Pro, then double-click install.bat.
     ffmpeg is required: winget install Gyan.FFmpeg
     Then: Window > Extensions > Rushlight.

https://github.com/thepatatra/rushlight
"@

$zip = Join-Path $dist "Rushlight-v$version.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
Write-Host "Paquet prêt / Package ready: $zip" -ForegroundColor Green
