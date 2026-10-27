# Signe Rushlight (certificat maison) -> Rushlight.zxp, à relancer après chaque modification du code.
$ErrorActionPreference = 'Stop'

$source = $PSScriptRoot
$work = Join-Path $env:TEMP 'rushlight-sign'   # chemin court : ZXPSignCmd n'aime pas les chemins longs
$tool = Join-Path $work 'ZXPSignCmd.exe'
New-Item -ItemType Directory -Force $work | Out-Null

if (-not (Test-Path $tool)) {
    [Net.ServicePointManager]::SecurityProtocol = 'Tls12'
    Invoke-WebRequest 'https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/4.1.3/x64/ZXPSignCmd.exe' -OutFile $tool -UseBasicParsing
}

# Copie uniquement les fichiers de l'extension
$stage = Join-Path $work 'stage\com.rushlight'
if (Test-Path (Join-Path $work 'stage')) { Remove-Item (Join-Path $work 'stage') -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($item in 'CSXS', 'css', 'img', 'js', 'jsx', 'index.html', '.debug') {
    Copy-Item (Join-Path $source $item) $stage -Recurse -Force
}

$cert = Join-Path $work 'cert.p12'
$zxp = Join-Path $work 'Rushlight.zxp'
$password = [guid]::NewGuid().ToString('N')
foreach ($f in $cert, $zxp) { if (Test-Path $f) { Remove-Item $f } }

& $tool -selfSignedCert FR IDF Rushlight Rushlight $password $cert
& $tool -sign $stage $zxp $cert $password -tsa http://timestamp.digicert.com
& $tool -verify $zxp
if ($LASTEXITCODE -ne 0) { throw 'La signature a échoué.' }

Copy-Item $zxp (Join-Path $source 'Rushlight.zxp') -Force
Write-Host 'Rushlight.zxp signé. Lancez install.bat pour l''installer.' -ForegroundColor Green
