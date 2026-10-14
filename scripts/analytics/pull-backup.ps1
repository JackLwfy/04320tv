$ErrorActionPreference = 'Stop'
$privateRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../.04320-analytics-private'))
if (-not (Test-Path -LiteralPath (Join-Path $privateRoot 'connection.json'))) { throw 'Private operator directory is missing' }
$destination = Join-Path $privateRoot 'offsite-backups'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$key = Join-Path $env:USERPROFILE '.ssh/codex_mail3_ed25519'
$sshArgs = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', '-i', $key)
try {
    $inventory = & ssh @sshArgs root@100.93.94.107 'sha256sum /root/04320-analytics/backups/analytics_*.sql.gz'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read remote backup inventory' }
    $verified = 0
    foreach ($line in $inventory) {
        if ($line -notmatch '^([a-f0-9]{64})\s+/root/04320-analytics/backups/(analytics_\d{8}T\d{6}Z_[a-f0-9]{8}\.sql\.gz)$') { throw 'Unexpected backup inventory entry' }
        $expected = $Matches[1]
        $name = $Matches[2]
        $target = Join-Path $destination $name
        if (-not (Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
            $partial = $target + '.partial'
            & scp @sshArgs "root@100.93.94.107:/root/04320-analytics/backups/$name" $partial
            if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Backup copy hash verification failed' }
            Move-Item -LiteralPath $partial -Destination $target -Force
        }
        $verified++
    }
    if ($verified -lt 1) { throw 'No verified remote backups' }
    $oldCopies = Get-ChildItem -LiteralPath $destination -File | Where-Object { $_.Name -match '^analytics_\d{8}T\d{6}Z_[a-f0-9]{8}\.sql\.gz$' } | Sort-Object Name -Descending | Select-Object -Skip 7
    foreach ($old in $oldCopies) {
        if ($old.Directory.FullName -ne [IO.Path]::GetFullPath($destination)) { throw 'Backup cleanup target mismatch' }
        Remove-Item -LiteralPath $old.FullName
    }
    "$(Get-Date -Format o) SUCCESS verified=$verified" | Set-Content -LiteralPath (Join-Path $privateRoot 'offsite-backup-status.txt')
    Write-Output "OFFSITE_BACKUP_OK verified=$verified"
} catch {
    "$(Get-Date -Format o) FAILED inspect task history and network" | Set-Content -LiteralPath (Join-Path $privateRoot 'offsite-backup-status.txt')
    throw
}
