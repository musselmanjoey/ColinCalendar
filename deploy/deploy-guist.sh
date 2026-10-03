#!/usr/bin/env bash
# Deploys ColinCalendar to guist (or updates it). Run from anywhere:
#   bash deploy/deploy-guist.sh
# Pulls master from GitHub on guist, installs deps, (re)starts the systemd user
# service, and checks it answers. Creates ~/colin-calendar/.env and
# ~/colin-calendar-data/wall.json on first run; never overwrites them.
set -euo pipefail

HOST="${GUIST_HOST:-musselmanjoey@192.168.1.177}"
PORT=3020

ssh "$HOST" bash -s <<EOF
set -euo pipefail
cd ~
if [[ ! -d colin-calendar/.git ]]; then
	git clone -q https://github.com/musselmanjoey/ColinCalendar.git colin-calendar
fi
cd colin-calendar
git fetch -q origin master && git reset -q --hard origin/master
npm ci --omit=dev --silent

mkdir -p ~/colin-calendar-data
if [[ ! -f .env ]]; then
	umask 077
	printf 'PORT=$PORT\nDATA_FILE=/home/musselmanjoey/colin-calendar-data/events.json\nCALENDAR_FEED_TOKEN=%s\n' \
		"\$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")" > .env
	echo "Created .env with a new feed token"
fi
# Settings added after the first install
grep -q '^TZ=' .env || echo 'TZ=America/New_York' >> .env
grep -q '^WALL_URL=' .env || echo 'WALL_URL=http://192.168.1.177:$PORT/wall' >> .env
[[ -f ~/colin-calendar-data/wall.json ]] || cp deploy/wall.example.json ~/colin-calendar-data/wall.json

cp deploy/colin-calendar.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable -q colin-calendar
systemctl --user restart colin-calendar
sleep 3
systemctl --user is-active colin-calendar
curl -sf -o /dev/null "http://localhost:$PORT/wall" && echo "Wall page: http://192.168.1.177:$PORT/wall"
EOF
