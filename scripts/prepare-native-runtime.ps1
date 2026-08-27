param(
    [string]$PythonVersion = "3.12.10",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Target = Join-Path $ProjectRoot "resources\native-python"
$Archive = Join-Path $env:TEMP "python-$PythonVersion-embed-amd64.zip"
$PythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"

if (-not $Force -and (Test-Path -LiteralPath (Join-Path $Target "python.exe"))) {
    Write-Host "Portable Python already exists: $Target" -ForegroundColor DarkGray
    exit 0
}

Write-Host "Preparing portable Python $PythonVersion..." -ForegroundColor Cyan
if (Test-Path -LiteralPath $Target) {
    Remove-Item -LiteralPath $Target -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $Target | Out-Null

Invoke-WebRequest -UseBasicParsing -Uri $PythonUrl -OutFile $Archive
Expand-Archive -LiteralPath $Archive -DestinationPath $Target -Force

$PthFile = Get-ChildItem -LiteralPath $Target -Filter "python*._pth" | Select-Object -First 1
if (-not $PthFile) { throw "Embedded Python ._pth file was not found." }
$Pth = Get-Content -LiteralPath $PthFile.FullName
$Pth = $Pth | Where-Object { $_ -ne '#import site' -and $_ -ne 'import site' }
foreach ($Entry in @('..\coding-tools-mcp\python_vendor', '..\coding-tools-mcp', 'Lib\site-packages')) {
    if ($Pth -notcontains $Entry) { $Pth += $Entry }
}
Set-Content -LiteralPath $PthFile.FullName -Value $Pth -Encoding Ascii

$Python = Join-Path $Target "python.exe"
& $Python -c "import coding_tools_mcp, jwt; print(coding_tools_mcp.__version__)"
if ($LASTEXITCODE -ne 0) { throw "Bundled Coding Tools MCP import verification failed." }

Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
Write-Host "Portable runtime ready: $Target" -ForegroundColor Green
