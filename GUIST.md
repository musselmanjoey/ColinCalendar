# The wall calendar on guist

This folder runs the calendar on the **living-room TV** (Samsung, 192.168.1.75). It also
turns that TV on at 10:00 on weekdays and off at 23:00. Stopping or breaking this
service changes what the TV does.

| What | Where |
|---|---|
| Code (git clone of github.com/musselmanjoey/wall-calendar, `master`) | `~/wall-calendar` |
| Service (systemd **user** unit, starts on boot) | `wall-calendar` → `~/.config/systemd/user/wall-calendar.service` |
| Port (LAN only) | 3020: `http://192.168.1.177:3020/wall` |
| Secrets/env (mode 600): PORT, TZ, WALL_URL, WALL_CONFIG, CONTROL_TOKEN | `~/wall-calendar/.env` |
| Live settings (mode 600): feeds, colors, weather, TV ip/mac/pairing token, schedule | `~/wall-calendar-data/wall.json` (re-read live, no restart needed) |
| Headless Chrome it borrows (picture-push fallback only) | `~/.cache/puppeteer/chrome-headless-shell/linux-128…`, installed by game-senser-services' puppeteer. If you clear that cache, the fallback breaks. |
| Deploy definition | `ansible/deploy-guist.yml` in this folder |

## Everyday commands

```bash
systemctl --user status wall-calendar
journalctl --user -u wall-calendar -n 50 -o cat     # schedule runs log as "schedule 10:00 calendar-on: ..."
curl -s "localhost:3020/api/tv/status?token=$(grep ^CONTROL_TOKEN ~/wall-calendar/.env | cut -d= -f2)"
```

Manual TV control: `/api/tv/{calendar-on,tv-off,tv-off-if-calendar,status}?token=<CONTROL_TOKEN>`.

## Changing it

Don't edit the code here. Change it in the repo, push, then from the laptop run
`bash deploy/deploy-guist.sh`, which runs the Ansible playbook on this box. To change
settings, edit `~/wall-calendar-data/wall.json` directly.

Don't restart it 09:55–10:06 or 22:55–23:06. The schedule fires up to 5 minutes late,
but a restart forgets what has already run.
