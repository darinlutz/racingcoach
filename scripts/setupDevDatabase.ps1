# Sets up the development database on Windows, with the PostgreSQL installed from postgresql.org (EDB's installer),
# the Windows counterpart of docs/development-database.md's Homebrew steps:
#   powershell -ExecutionPolicy Bypass -File scripts\setupDevDatabase.ps1
#
# 1. Asks for the postgres superuser's password (the one chosen when PostgreSQL was installed; used for this run only,
#    never saved).
# 2. Creates the login role racingcoach_dev, with a new random password, and the database racingcoach_dev it owns.
#    Run again, it keeps the database and gives the role a new password.
# 3. Points .env.local's DATABASE_URL at it. A DATABASE_URL that isn't on this computer is kept as
#    PRODUCTION_DATABASE_URL (unless that's already set), which only `npm run db:dev -- --copy-from production` reads.
#    The old file is kept as .env.local.bak.
# 4. Runs `npm run db:dev -- --copy-from production` (or `npm run db:dev` without PRODUCTION_DATABASE_URL): the schema,
#    then Track Data, Car Data and site settings copied read only from the live database; nothing personal.
param(
  [int]$Port = 5432,
  [string]$PsqlPath
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env.local'
$name = 'racingcoach_dev'

if (-not $PsqlPath) {
  $PsqlPath = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.FullName -replace '.*PostgreSQL\\(\d+).*', '$1') } -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $PsqlPath -or -not (Test-Path $PsqlPath)) { throw 'psql.exe not found. Pass -PsqlPath "C:\Program Files\PostgreSQL\<version>\bin\psql.exe".' }
Write-Host "Using $PsqlPath on port $Port"

$secure = Read-Host 'Password of the postgres superuser' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$env:PGCONNECT_TIMEOUT = '10'

# Letters and digits only, so it needs no escaping in the connection URL
$chars = [char[]]'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$rolePassword = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })

$sql = @"
SELECT 'CREATE ROLE $name LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$name') \gexec
SELECT format('ALTER ROLE $name LOGIN PASSWORD %L', :'pw') \gexec
SELECT 'CREATE DATABASE $name OWNER $name' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$name') \gexec
"@
$sql | & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -v "pw=$rolePassword" -q
if ($LASTEXITCODE -ne 0) { throw 'psql failed (wrong postgres password?). Nothing was changed in .env.local.' }
Remove-Item Env:PGPASSWORD
Write-Host "Role and database $name are ready."

$devUrl = "postgres://${name}:$rolePassword@127.0.0.1:$Port/$name"
$lines = if (Test-Path $envFile) { [IO.File]::ReadAllLines($envFile) } else { @() }
if (Test-Path $envFile) { Copy-Item $envFile "$envFile.bak" -Force }
$hasProduction = [bool]($lines | Where-Object { $_ -match '^PRODUCTION_DATABASE_URL=' })
$out = New-Object System.Collections.Generic.List[string]
$wroteDev = $false
foreach ($line in $lines) {
  if ($line -match '^DATABASE_URL=(.*)$') {
    $current = $Matches[1].Trim().Trim('"', "'")
    $isLocal = $current -match '@(localhost|127\.0\.0\.1|\[::1\])[:/]'
    if (-not $isLocal -and -not $hasProduction) {
      $out.Add("PRODUCTION_DATABASE_URL=$current")
      $hasProduction = $true
      Write-Host 'Kept the old DATABASE_URL as PRODUCTION_DATABASE_URL.'
    }
    if (-not $wroteDev) { $out.Add("DATABASE_URL=$devUrl"); $wroteDev = $true }
    continue
  }
  $out.Add($line)
}
if (-not $wroteDev) { $out.Add("DATABASE_URL=$devUrl") }
[IO.File]::WriteAllText($envFile, (($out -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))
Write-Host ".env.local now points DATABASE_URL at $name (the old file is .env.local.bak)."

Push-Location $root
try {
  $env:DATABASE_URL = $devUrl
  if ($hasProduction) { npm run db:dev -- --copy-from production } else { npm run db:dev }
  if ($LASTEXITCODE -ne 0) { throw 'npm run db:dev failed.' }
} finally {
  Pop-Location
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Done. Start the site with npm run dev, sign up at http://localhost:3000/signup, then make yourself an Admin:'
Write-Host "  & '$PsqlPath' -h 127.0.0.1 -p $Port -U $name -d $name -c `"UPDATE racingcoach.\`"Users\`" SET role = 'Admin', email_verified_at = now() WHERE email_address = '<your email>'`""
Write-Host "  (the password is in .env.local's DATABASE_URL)"
