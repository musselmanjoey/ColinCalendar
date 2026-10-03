# TV app (Tizen) — status and handoff

**Status 2026-10-03: WORKING.** The Wall Calendar app (1.0.3) is installed on the TV and is
what `calendar-on` opens; the DLNA picture push is the automatic fallback. Updates:
`powershell -File tv-app\install.ps1` from the laptop. It signs with the `a2s` profile
(Apps2Samsung's bundled certificate, which this TV accepts), so no Samsung login is needed.
Gotchas learned: an iframe renders at its 300x150 default on this TV, so the app redirects
straight to /wall; app-launch POSTs return a malformed "HTTP/..." body; `tizen install`
fails on file names with spaces. Everything below is the history of how we got here.

Goal: replace the DLNA picture push with a real app on the living-room Samsung TV
(UN50TU7000FXZA, 2021, Tizen 6.0, 192.168.1.75) so the wall calendar is live
(ticking clock, rotating views, no loading-screen flicker on each update).

## What works today (no app needed)

- guist (192.168.1.177) runs ColinCalendar on port 3020. `/wall` is the calendar page.
- guist turns the TV on/off over the network (Wake-on-LAN burst + remote-API Power key)
  and shows the calendar by rendering `/wall` to a 4K JPEG and pushing it over DLNA.
  See `lib/samsung-tv.js`, `lib/tv-display.js`, `lib/scheduler.js`.
- Schedule (in `~/colin-calendar-data/wall.json` on guist): 06:30 calendar-on,
  23:00 off only if the calendar is on screen.
- The TV browser cannot be pointed at a URL remotely (DEEP_LINK / NATIVE_LAUNCH are
  ignored, DLNA rejects text/html) and blind remote-key typing is unreliable. Don't retry.

## The app

`tv-app/` (committed): `config.xml` (app id `WallCal001.WallCalendar`, profile
`tv-samsung`), `index.html` (full-screen iframe of `http://192.168.1.177:3020/wall`,
screensaver off via `webapis.appcommon`, retries if guist is down), `icon.png`.
Once installed, guist would launch it with
`POST http://192.168.1.75:8001/api/v2/applications/WallCal001.WallCalendar`
(that REST launch is proven for other apps on this TV, e.g. Netflix, YouTube, Browser).

## Laptop state (Windows, 192.168.1.74)

- TV Developer Mode is ON with Host PC IP = 192.168.1.74. `sdb connect 192.168.1.75:26101`
  works (Windows Firewall prompt for sdb.exe was approved).
- `C:\tizen-studio` — Tizen Studio 6.1 installed via the official GUI installer
  (`C:\tizen-dl\web-ide_Tizen_Studio_6.1_windows-64.exe`, Samsung-signed).
- Installed on top via CLI: `cert-add-on` (Samsung Certificate Extension) and
  TV extension resources. `C:\tizen-studio\tools\certificate-manager\certificate-manager.exe`
  exists, but its CLI install reported failure and was never confirmed to launch.
- `C:\tizen-studio-backup-clean` — clean copy of the CLI-only Tizen (has sdb.exe,
  tools\ide = the `tizen` CLI, device-manager). Used to restore tools that the failed
  package-manager runs deleted.
- `C:\tizen-jdk` — copy of Tizen's Java 8, used to run `PackageManagerV2-cli.jar`.
- `C:\tizen-studio\.info\installedpackage.list` was edited (13 package versions bumped
  to the repo's) so the package manager stops trying to self-update; the original is
  `C:\tizen-dl\installedpackage.list.bak`.

## What went wrong (so the next attempt doesn't repeat it)

1. Every `package-manager-cli install` first tries to update base packages, and that
   update fails ("Cannot install updates": an install script exits 1). Admin rights
   didn't fix it. Each failed run also uninstalled tools (sdb.exe, tools\ide).
2. The CLI install of `Certificate-Manager` failed partway; Tizen Studio then said
   "Certificate Manager is not installed or the installation path is invalid".
3. Root cause of the script failure was never found. The approach (driving Samsung's
   GUI-first tooling from the CLI and patching each failure) was the mistake.

## Next step

Follow a proven, documented sideloading path (research in progress), then:
sign `tv-app/` → install with sdb/tizen CLI → launch via REST → switch the
`calendar-on` action in `lib/samsung-tv.js` to launch the app, keeping the DLNA
picture push as the fallback if the launch fails.
