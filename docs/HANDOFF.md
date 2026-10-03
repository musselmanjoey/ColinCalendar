# Handoff: wall calendar → cleanup, rename, home automation (2026-10-03)

Start the next chat by reading this file. It says what exists, where it runs, and
what's planned. Details on the TV app history: `docs/tv-app-status.md`.

## What this is now

A shared wall calendar shown on the living-room TV, fully automatic:

- **guist** (home server, 192.168.1.177) runs one Node/Express service on port 3020:
  - `/wall`: the TV calendar page (cozy "Cafe" theme, rotating day/week/month views,
    weather, Today/Tomorrow, dark espresso palette in the evening). Reads Google calendar
    secret iCal feeds (Joey, Meal Plan, Shae, Trope, Writing, Personal, US Holidays) and
    re-reads them every ~50 s.
  - The original ColinCalendar web app (`/`, add/delete all-day events) and its token-gated
    ICS feed (`/api/calendar.ics`). Its events show on the wall as "Shared".
  - TV control and scheduler (`lib/samsung-tv.js`, `lib/scheduler.js`): Wake-on-LAN
    burst + remote-API Power key turns the TV on; then it opens the sideloaded TV app.
    Schedule: **weekdays 10:00 on**, **23:00 off only if the calendar is showing**.
    Manual control: `/api/tv/{calendar-on,tv-off,status}?token=<CALENDAR_FEED_TOKEN>`.
- **TV** (Samsung UN50TU7000FXZA, 2021, Tizen 6.0, 192.168.1.75): Developer Mode on,
  Host PC IP = the Windows laptop. Runs the app `WallCal001.WallCalendar` (`tv-app/`),
  which just redirects full screen to `http://192.168.1.177:3020/wall`.
- **Fallback:** if the app won't open (e.g. a firmware update turned Developer Mode off),
  guist renders `/wall` to a 4K JPEG with headless Chrome and pushes it over DLNA
  (`lib/tv-display.js`).

## Everything that lives on guist (the integration to keep visible)

| What | Where |
|---|---|
| Code (git clone of this repo, `master`) | `~/colin-calendar` |
| systemd user unit (enabled, starts on boot) | `~/.config/systemd/user/colin-calendar.service` (source: `deploy/colin-calendar.service`) |
| Secrets/env (mode 600): PORT=3020, TZ=America/New_York, WALL_URL, DATA_FILE, CALENDAR_FEED_TOKEN | `~/colin-calendar/.env` |
| Settings, re-read live: feed URLs (secret), colors, weather, TV ip/mac/pairing token, schedule, night window | `~/colin-calendar-data/wall.json` (mode 600) |
| Web-app events (not backed up) | `~/colin-calendar-data/events.json` |
| Headless Chrome it borrows | `~/.cache/puppeteer/chrome-headless-shell/linux-128…` (installed by game-senser-services' puppeteer; if that cache is cleared, the DLNA fallback breaks) |
| Logs | `journalctl --user -u colin-calendar` |
| Deploy | `bash deploy/deploy-guist.sh` from the laptop (git pull + npm ci + restart) |

Also recorded in `~/Projects/CLAUDE.md` → Guist Box → Services table (row "colin-calendar").
Not in any Ansible playbook.

## Everything that lives on the Windows laptop

- Repo: `C:\Users\musse\Projects\ColinCalendar`.
- TV app tooling: `C:\tizen-studio` (+ `C:\tizen-studio-data`, signing profile `a2s` =
  Apps2Samsung's bundled cert, password is the public Tizen default). `tv-app/install.ps1`
  signs and installs app updates. Apps2Samsung is installed too (winget).
- Leftovers safe to delete once the rename is done: `C:\tizen-dl` (installers, logs),
  `C:\tizen-jdk`, `C:\tizen-studio-backup-clean`, `C:\tizen-studio-cli-old`,
  `C:\tizen-studio-data-cli-old`. Keep `C:\tizen-studio` + `C:\tizen-studio-data`
  (needed for `install.ps1`).
- `codes.md` in the repo root holds Shae's secret feed URLs (gitignored). Already copied
  into guist's wall.json, so it can be deleted.

## Cleanup / rename plan (next chat)

1. **Rename** ColinCalendar → `wall-calendar`: GitHub repo (`musselmanjoey/ColinCalendar`),
   local folder, package.json name, service name (`colin-calendar` → `wall-calendar`),
   guist paths (`~/colin-calendar`, `~/colin-calendar-data`), deploy script, the
   `~/Projects/CLAUDE.md` row, and the Claude memory folder for this project (it's keyed
   by path, so it'll need moving).
2. **Delete dead weight:** `wall-calendar/` (the Raspberry Pi + MagicMirror plan, never
   used), `tv-app-dist/`, `codes.md`, the browser-launch leftovers in `lib/samsung-tv.js`
   (`findBrowser`, `browserVisible`), `/api/tv/report`, the `?static`-only "Updated" bits
   if unused, the `brightness` setting (replaced by the evening palette).
3. **Decide about the original web app** (`public/index.html` etc.): keep as the
   "add a shared event" page, or drop it now that everything comes from Google.
4. **Make the guist integration obvious:** e.g. a `README` on guist next to the code, an
   Ansible role in the guist playbook (or this repo's own), a backup for `events.json` and
   `wall.json`, and a health check (`/api/tv/status`) wired into whatever monitors guist.
5. **Write a real README + CLAUDE.md** for the renamed repo (architecture, run locally,
   deploy, TV app update, config reference).

## Future (to discuss)

Possible growth into a home-automation space: more rooms/screens, other TV schedules
(e.g. "open YouTube at 7"), lights, the Calendar project's planning features
(`~/Projects/Calendar`, dinner planning on the Meal Plan calendar). Decide repo structure
before adding things.
