$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskLog = Join-Path $taskRoot 'node_modules\.cache\sifit-mongodb-setup.log'
New-Item -ItemType Directory -Path (Split-Path -Parent $taskLog) -Force | Out-Null

try {
    $taskService = Get-CimInstance Win32_Service -Filter "Name='MongoDB'"
    if ($taskService.PathName -notmatch '--config\s+"([^"]+)"') {
        throw 'Cannot identify the MongoDB service configuration file.'
    }
    $taskConfigPath = $Matches[1]
    $taskConfig = [IO.File]::ReadAllText($taskConfigPath)
    if ($taskConfig -match '(?m)^replication:') {
        if ($taskConfig -notmatch 'replSetName:\s*["'']?sifit-local') {
            throw 'An existing replication configuration needs to be reviewed.'
        }
    } else {
        $taskBackupPath = "$taskConfigPath.sifit-backup-$(Get-Date -Format yyyyMMddHHmmss)"
        Copy-Item -LiteralPath $taskConfigPath -Destination $taskBackupPath
        $taskUpdatedConfig = $taskConfig + "`r`nreplication:`r`n  replSetName: sifit-local`r`n"
        [IO.File]::WriteAllText($taskConfigPath, $taskUpdatedConfig)
        try {
            Restart-Service -Name MongoDB -ErrorAction Stop
            (Get-Service MongoDB).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
        } catch {
            [IO.File]::WriteAllText($taskConfigPath, $taskConfig)
            Start-Service -Name MongoDB -ErrorAction SilentlyContinue
            throw
        }
    }
    'SUCCESS: MongoDB service configured for sifit-local; initialize the replica set next.' | Set-Content -LiteralPath $taskLog
} catch {
    ('FAILED: ' + $_.Exception.Message) | Set-Content -LiteralPath $taskLog
    exit 1
}
