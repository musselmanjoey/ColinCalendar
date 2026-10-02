#!/usr/bin/env bash
# Deploys ColinCalendar to guist (or updates it). Run from anywhere:
#   bash deploy/deploy-guist.sh
# Pulls master from GitHub on guist, installs deps, (re)starts the systemd user
# service, and checks it answers. Creates ~/colin-calendar/.env on first run.
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

cp deploy/colin-calendar.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable -q colin-calendar
systemctl --user restart colin-calendar
sleep 2
systemctl --user is-active colin-calendar
curl -sf -o /dev/null "http://localhost:$PORT/" && echo "Web app up on port $PORT"
TOKEN=\$(grep ^CALENDAR_FEED_TOKEN= .env | cut -d= -f2)
echo "Feed: http://192.168.1.177:$PORT/api/calendar.ics?token=\$TOKEN"
EOF
