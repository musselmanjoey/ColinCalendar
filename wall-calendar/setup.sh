#!/usr/bin/env bash
# One-time install on a fresh Raspberry Pi OS (Bookworm, 64-bit, Desktop).
# Run from this folder after creating wallcal.env:   ./setup.sh
# Safe to re-run: it skips what's already installed and rewrites config + cron.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MM="$HOME/MagicMirror"

[[ -f "$HERE/wallcal.env" ]] || { echo "Create wallcal.env first (cp wallcal.env.example wallcal.env)"; exit 1; }
# shellcheck disable=SC1091
set -a; source "$HERE/wallcal.env"; set +a

echo "==> Packages (v4l-utils provides cec-ctl)"
sudo apt-get update -qq
sudo apt-get install -y -qq v4l-utils git curl

echo "==> Disabling screen blanking"
sudo raspi-config nonint do_blanking 1

if [[ ! -d "$MM" ]]; then
	echo "==> Installing MagicMirror (community installer)"
	echo "    When it asks whether to start MagicMirror with pm2 at boot, answer YES."
	bash -c "$(curl -sL https://raw.githubusercontent.com/sdetweil/MagicMirror_scripts/master/raspberry.sh)"
else
	echo "==> MagicMirror already at $MM, skipping install"
fi

if [[ ! -d "$MM/modules/MMM-CalendarExt3" ]]; then
	echo "==> Installing MMM-CalendarExt3"
	git clone --depth 1 https://github.com/MMRIZE/MMM-CalendarExt3 "$MM/modules/MMM-CalendarExt3"
	(cd "$MM/modules/MMM-CalendarExt3" && { [[ -f package.json ]] && npm install --omit=dev --silent || true; })
else
	echo "==> MMM-CalendarExt3 already installed"
fi

echo "==> Writing config.js and custom.css"
node "$HERE/render-config.js" --mm "$MM"

echo "==> Installing wallcal-tv"
sudo install -m 755 "$HERE/tv.sh" /usr/local/bin/wallcal-tv

echo "==> Installing cron jobs (TV on $TV_ON_TIME, off $TV_OFF_TIME)"
to_cron() { local h="${1%%:*}" m="${1##*:}"; echo "$((10#$m)) $((10#$h)) * * *"; }
(
	crontab -l 2>/dev/null | grep -v '# wallcal' || true
	echo "@reboot sleep 30 && /usr/local/bin/wallcal-tv init >/tmp/wallcal-tv.log 2>&1 # wallcal"
	echo "$(to_cron "$TV_ON_TIME") /usr/local/bin/wallcal-tv on >>/tmp/wallcal-tv.log 2>&1 # wallcal"
	echo "$(to_cron "$TV_OFF_TIME") /usr/local/bin/wallcal-tv off >>/tmp/wallcal-tv.log 2>&1 # wallcal"
) | crontab -
crontab -l | grep '# wallcal'

echo "==> Checking pm2"
if command -v pm2 >/dev/null && pm2 describe MagicMirror >/dev/null 2>&1; then
	pm2 restart MagicMirror >/dev/null
	echo "MagicMirror is managed by pm2 and was restarted."
else
	echo "WARNING: MagicMirror isn't running under pm2, so it won't start on boot."
	echo "         Fix: bash -c \"\$(curl -sL https://raw.githubusercontent.com/sdetweil/MagicMirror_scripts/master/fixuppm2.sh)\""
fi

echo
echo "Done. Next: wallcal-tv init && wallcal-tv status, then wallcal-tv off / on to test the TV."
