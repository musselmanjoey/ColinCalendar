#!/usr/bin/env bash
# Deploys the wall calendar to guist (first install or update). Run from anywhere:
#   bash deploy/deploy-guist.sh               # full deploy
#   bash deploy/deploy-guist.sh --tags=verify # just check it
# Pulls master on guist, then runs ansible/deploy-guist.yml there. The playbook
# is the source of truth for what's installed; see GUIST.md.
set -euo pipefail

HOST="${GUIST_HOST:-musselmanjoey@192.168.1.177}"

ssh "$HOST" bash -s -- "$@" <<'REMOTE'
set -euo pipefail
cd ~
[[ -d wall-calendar/.git ]] || git clone -q https://github.com/musselmanjoey/wall-calendar.git wall-calendar
cd wall-calendar
git fetch -q origin master && git reset -q --hard origin/master
~/.local/bin/ansible-playbook -i ansible/inventory.ini ansible/deploy-guist.yml "$@"
REMOTE
