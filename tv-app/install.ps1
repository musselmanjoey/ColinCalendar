# Signs tv-app/ and installs it on the living-room TV. Run from the repo root:
#   powershell -File tv-app\install.ps1
# Needs (on this laptop): Tizen Studio at C:\tizen-studio and the "a2s" signing
# profile (Apps2Samsung's bundled certificate, which this TV accepts). See
# docs/tv-app-status.md. The TV's Developer Mode must point at this laptop's IP.
$ErrorActionPreference = 'Stop'
$tizen = 'C:\tizen-studio\tools\ide\bin\tizen.bat'
$sdb = 'C:\tizen-studio\tools\sdb.exe'
$tv = '192.168.1.75:26101'
$build = Join-Path $env:TEMP 'wallcal-build'

Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $build | Out-Null
Copy-Item "$PSScriptRoot\config.xml", "$PSScriptRoot\index.html", "$PSScriptRoot\icon.png" $build

& $tizen package -t wgt -s a2s -- $build
# tizen install chokes on the space in the default "Wall Calendar.wgt" name
Rename-Item (Join-Path $build 'Wall Calendar.wgt') 'WallCalendar.wgt'

& $sdb connect $tv
& $tizen install -n WallCalendar.wgt -s $tv -- $build

# Restart it so the new version shows
& $sdb -s $tv shell 0 was_kill WallCal001.WallCalendar | Out-Null
Start-Sleep -Seconds 2
Invoke-RestMethod -Method Post -Uri 'http://192.168.1.75:8001/api/v2/applications/WallCal001.WallCalendar' | Out-Null
'Installed and launched.'
