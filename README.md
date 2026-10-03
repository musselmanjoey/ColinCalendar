# wall-calendar

The shared family calendar on the living-room TV. Nobody touches the TV: the home server
(guist) turns it on at 10:00 on weekdays, opens the calendar, and turns it off at 23:00
if the calendar is still on screen.

```
Google Calendar (secret iCal feeds) ─┐
Open-Meteo weather ──────────────────┤
                                     ▼
                guist :3020  ── Node/Express (this repo, systemd user unit "wall-calendar")
                  │  /wall              the calendar page (day/week/month, rotating)
                  │  /api/wall/data     events + weather JSON, re-read every ~50 s
                  │  /api/tv/*          TV control (token)
                  │  scheduler          wall.json "schedule" entries
                  ▼
   Samsung UN50TU7000 (192.168.1.75, Tizen 6.0)
     1. Wake-on-LAN burst → TV network up (standby)
     2. remote API KEY_POWER (wss :8002) → screen on
     3. REST POST :8001/api/v2/applications/WallCal001.WallCalendar
        → our sideloaded app (tv-app/) redirects full screen to http://192.168.1.177:3020/wall
     fallback: headless Chrome renders /wall?static=1 to a 4K JPEG, pushed over DLNA
```

## Layout

| Path | What |
|---|---|
| `api/index.js` | Express server: `/wall`, `/api/wall/data`, `/api/tv/*`, DLNA frames, starts the scheduler |
| `lib/wall.js` | Loads `wall.json`, fetches and expands the iCal feeds, weather, night mode |
| `lib/samsung-tv.js` | TV power state, Wake-on-LAN, remote keys, app launch, `showCalendar` |
| `lib/tv-display.js` | Fallback: renders `/wall` with headless Chrome and pushes it over DLNA |
| `lib/scheduler.js` | Runs the `schedule` entries (checked every 30 s, fires up to 5 min late) |
| `public/wall.*` | The calendar page (plain JS, ES5 so the TV's old engine runs it) |
| `tv-app/` | The Tizen TV app (`config.xml`, `index.html`, icon) and `install.ps1` |
| `ansible/deploy-guist.yml` | Everything installed on guist. The source of truth |
| `deploy/` | Deploy wrapper, systemd unit, example `wall.json` |
| `GUIST.md` | Guide for anyone logged in to guist |
| `docs/tv-app-status.md` | How the TV app was sideloaded, the gotchas, and the dead ends |

## Run locally

```bash
npm install
cp deploy/wall.example.json wall.json      # add feed URLs; leave tv.ip empty to keep the scheduler idle
WALL_CONFIG=wall.json PORT=3000 npm run dev
# http://localhost:3000/wall   (?view=day|week|month pins a view, ?theme=N pins a theme, ?static=1 is the TV-image layout)
```

Without `CONTROL_TOKEN`, the `/api/tv/*` routes are open. Set it whenever a real TV is configured.

## Deploy to guist

```bash
bash deploy/deploy-guist.sh                # git pull on guist + run the Ansible playbook there
bash deploy/deploy-guist.sh --tags=verify  # just check the service and /wall
```

The playbook creates `~/wall-calendar-data/wall.json` and the control token only if they
are missing, so it never overwrites live settings. Avoid deploying 09:55–10:06 and
22:55–23:06: a restart forgets which schedule entries already ran that day.

## Update the TV app

Only needed when `tv-app/` changes (the calendar itself is served live from guist):

```powershell
powershell -File tv-app\install.ps1
```

You need Tizen Studio at `C:\tizen-studio` with the `a2s` signing profile, and the TV's
Developer Mode Host PC IP must be this laptop (192.168.1.74). Don't change the app id
(`WallCal001.WallCalendar`) or the widget id in `config.xml`: the TV would treat the
result as a different app.

## Configuration

**`.env`** on guist (mode 600; the playbook writes everything except the token):

| Key | Value |
|---|---|
| `PORT` | 3020 |
| `TZ` | `America/New_York`. Schedule times and the "today" boundary use it |
| `WALL_URL` | `http://192.168.1.177:3020/wall`, the address the TV uses |
| `WALL_CONFIG` | `/home/musselmanjoey/wall-calendar-data/wall.json` |
| `CONTROL_TOKEN` | required by `/api/tv/*` as `?token=` |

**`wall.json`** (mode 600, re-read on every request, so edits apply without a restart):

| Key | Meaning |
|---|---|
| `feeds` | `[{ name, color, url }]`: Google "secret address in iCal format" URLs. A feed with an empty `url` is skipped |
| `weather` | `{ lat, lon }` for Open-Meteo |
| `night` | `{ start, end }` (`"21:30"`, `"06:00"`): dark espresso palette window |
| `rotateSeconds` | seconds per view while rotating (default 60) |
| `staticView` | view used for the DLNA still image (default `week`) |
| `theme` | pins a theme number from `wall.css`; unset means rotate |
| `tv` | `{ ip, mac, token }`. `token` is written automatically after the TV's one-time Allow prompt |
| `schedule` | `[{ time, days, action, appId? }]`. `days`: `daily`, `weekdays`, `weekends` or `["mon","fri"]`. `action`: `calendar-on`, `tv-off`, `tv-off-if-calendar`, `open-app` |

## TV control API

`GET /api/tv/<action>?token=<CONTROL_TOKEN>`: `status`, `calendar-on`, `tv-off`,
`tv-off-if-calendar`, `open-app&app=<id>` (YouTube `111299001912`, Netflix
`3201907018807`), `key&key=KEY_…`, `pair`. These are GET routes, so a phone bookmark works.
