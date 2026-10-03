# wall-calendar: notes for Claude

Read `README.md` for the architecture. This repo drives a real TV in the living room, and
the family relies on it. **Don't break it.**

## Rules

- **guist is production.** Change code here, push, then run `bash deploy/deploy-guist.sh`.
  Don't edit files in `~/wall-calendar` on guist. If the box needs a new setting,
  package or file, add it to `ansible/deploy-guist.yml`, not to a one-off SSH command.
- **Deploy windows.** Don't restart the service 09:55–10:06 or 22:55–23:06 ET. The
  scheduler's "already ran today" memory is lost on restart.
- **Never overwrite `~/wall-calendar-data/wall.json`.** It holds the secret feed URLs and
  the TV pairing token, and the service rewrites it itself. Edit it in place; keep it mode 600.
- **Verify after any deploy:** run `/api/tv/status?token=…` (power, `calendarOnScreen`,
  schedule) and check that the journal shows `TV scheduler running`. Run `calendar-on` /
  `tv-off` against the real TV only with Joey's OK, because it switches the living-room TV.
- **The TV app** (`tv-app/`) is installed from the Windows laptop with `tv-app/install.ps1`.
  Keep the app id `WallCal001.WallCalendar` and the `config.xml` widget id unchanged.
- **The page runs on the TV's old browser engine:** `public/wall.js` is ES5 (`var`, XHR, no
  arrow functions, no fetch).
- Times in `wall.json` use guist's `TZ=America/New_York`.

## Dead ends (don't retry)

- Pointing the TV's browser at a URL remotely: DEEP_LINK / NATIVE_LAUNCH are ignored on
  this 2021 model; DLNA rejects text/html (error 714); blind remote-key navigation is unreliable.
- Driving Tizen Studio's package manager from the CLI. See `docs/tv-app-status.md`.
- An iframe in the TV app renders at 300x150; the app redirects to `/wall` instead.

## Where things live

- guist: `~/wall-calendar` (code), `~/wall-calendar-data` (settings), user unit
  `wall-calendar`, port 3020. Box-side guide: `GUIST.md`.
- Laptop: `C:\tizen-studio` + `C:\tizen-studio-data` (signing profile `a2s`) for TV app installs.
- Cross-project record: the guist services table in `~/Projects/CLAUDE.md`.
