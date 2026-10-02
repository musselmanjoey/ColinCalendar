# Wall calendar

A Raspberry Pi running [MagicMirror²](https://magicmirror.builders) that shows a
month grid of everyone's calendars on the living-room TV. The wall is read-only:
events are added on phones (Google/iCloud) or in the ColinCalendar web app, and
the Pi pulls them in as ICS feeds. Design notes and open questions are in the
"Wall Calendar Display — Developer Handoff" doc.

| File | What it does |
|---|---|
| `wallcal.env.example` | Settings template: feed URLs, colors, weather location, TV on/off times, brightness. Copy to `wallcal.env` (gitignored). |
| `config.template.js` | MagicMirror layout: clock, weather, hidden `calendar` data module, MMM-CalendarExt3 month view. |
| `custom.css` | Dark theme. The brightness value is filled in from `wallcal.env`. |
| `render-config.js` | Builds `config.js` + `custom.css` from the two files above and `wallcal.env`. No dependencies. |
| `tv.sh` | HDMI-CEC control, installed as `wallcal-tv {init,on,off,status}`. |
| `setup.sh` | One-time Pi install. Safe to re-run. |

The shared calendar comes from the web app's feed at `/api/calendar.ics`. If
`CALENDAR_FEED_TOKEN` is set in Vercel, the feed needs `?token=<that value>`.

## Getting feed URLs

- **Google:** calendar.google.com → Settings → pick the calendar → *Integrate
  calendar* → **Secret address in iCal format**.
- **iCloud:** Calendar app → share the calendar → turn on **Public Calendar** →
  copy the link. Anyone with the link can view that calendar.

## Test on a laptop first

```bash
cp wallcal.env.example wallcal.env      # fill in the URLs
node render-config.js --out ./build     # checks the env and writes build/config.js
```

To see it rendered, install MagicMirror on the laptop
(`git clone https://github.com/MagicMirrorOrg/MagicMirror && cd MagicMirror && npm run install-mm`),
clone `https://github.com/MMRIZE/MMM-CalendarExt3` into its `modules/`, then
`node render-config.js --mm <path to MagicMirror>` and `npm run start` there.

## Install on the Pi

1. Flash Raspberry Pi OS (Bookworm, 64-bit, **Desktop**) and turn on SSH and Wi-Fi in Imager.
2. Plug the Pi into the TV using **HDMI0**, the micro-HDMI port next to USB-C power.
3. On the TV: Anynet+ (HDMI-CEC) **on**, Viewing Information Services **off**, backlight lowered.
4. Copy this folder to the Pi, create `wallcal.env`, and run `bash setup.sh`.
   Answer **yes** when the MagicMirror installer asks about pm2.

Changed `wallcal.env`? Run `node render-config.js && pm2 restart MagicMirror`.
Changed the on/off times? Re-run `bash setup.sh`.

## Troubleshooting

- `wallcal-tv status` prints nothing useful: wrong port. Try `CEC_DEV=/dev/cec1 wallcal-tv status`.
- TV wakes but stays on another input: the active-source call in `tv.sh on` is
  the most likely piece to need adjusting for this Samsung model.
- Cron output goes to `/tmp/wallcal-tv.log`. MagicMirror logs: `pm2 logs MagicMirror`.
