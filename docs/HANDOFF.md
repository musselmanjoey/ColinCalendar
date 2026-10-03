# Handoff (updated 2026-10-03)

Done 2026-10-03: renamed ColinCalendar → wall-calendar (GitHub, package, guist service and
paths, memory), removed the Pi/MagicMirror plan, the add-an-event web app, `codes.md`,
`tv-app-dist/` and dead browser code, moved guist deployment into `ansible/deploy-guist.yml`,
added `GUIST.md`, `README.md` and `CLAUDE.md`, and deleted the laptop's Tizen leftovers.
Cut-over verified (schedule, feeds, TV reachable); the downtime was about 12 s.

## Still open

- **2026-10-10 or later:** after a clean week (weekday 10:00 on, 23:00 off), delete the rollback
  on guist: `~/colin-calendar`, `~/colin-calendar-data`,
  `~/.config/systemd/user/colin-calendar.service`, and the "retired unit" tasks in the playbook.
- Not chosen this round: a nightly backup of `wall.json`, and a health check through the
  game-senser Telegram alerts (`game-senser-services/scripts/health-check.cjs`).

## Future (to discuss)

Growing into a home-automation space: more rooms/screens, other TV schedules (e.g. "open
YouTube at 7"), lights, the Calendar project's planning features (`~/Projects/Calendar`,
dinner planning on the Meal Plan calendar). Decide repo structure before adding things.
