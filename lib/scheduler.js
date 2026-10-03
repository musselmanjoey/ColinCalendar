// Runs the TV schedule from wall.json. Each entry:
//   { "time": "06:30", "days": "daily", "action": "calendar-on" }
// days: "daily" | "weekdays" | "weekends" | ["mon","wed",...]
// actions:
//   calendar-on          turn the TV on and show the wall calendar (pushed as an image)
//   tv-off               turn the TV off
//   tv-off-if-calendar   turn it off only if the calendar is what's on screen
//   open-app             turn on and open "appId" (e.g. YouTube 111299001912,
//                        Netflix 3201907018807)
// Times are in the service's TZ (America/New_York, set in .env).

const { loadConfig, minutes } = require('./wall');
const tv = require('./samsung-tv');

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const lastRun = new Map(); // entry key -> 'YYYY-MM-DD'
const history = []; // recent runs, newest first, for /api/tv/status

function runsToday(days, now) {
  const today = DAY_NAMES[now.getDay()];
  if (!days || days === 'daily') return true;
  if (days === 'weekdays') return now.getDay() >= 1 && now.getDay() <= 5;
  if (days === 'weekends') return now.getDay() === 0 || now.getDay() === 6;
  return Array.isArray(days) && days.map((d) => String(d).slice(0, 3).toLowerCase()).includes(today);
}

async function runAction(entry, urls) {
  switch (entry.action) {
    case 'calendar-on': return tv.showCalendar(urls.wallUrl, urls.baseUrl);
    case 'tv-off': return tv.turnOff();
    case 'tv-off-if-calendar': return tv.turnOffIfShowingCalendar();
    case 'open-app': return tv.showApp(entry.appId);
    default: throw new Error(`unknown action ${entry.action}`);
  }
}

function record(entry, result, error) {
  history.unshift({ at: new Date().toString(), action: entry.action, time: entry.time, result, error });
  history.length = Math.min(history.length, 20);
  console.log(`schedule ${entry.time} ${entry.action}: ${error ? `FAILED ${error}` : result}`);
}

async function tick(urls) {
  const config = loadConfig();
  if (!config.tv || !config.tv.ip) return;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = now.toDateString();

  for (const entry of config.schedule || []) {
    const key = `${entry.time}|${entry.action}|${JSON.stringify(entry.days)}|${entry.appId || ''}`;
    // Fire within 5 minutes after the set time, once per day (survives a missed tick)
    const late = nowMin - minutes(entry.time);
    if (late < 0 || late > 5 || lastRun.get(key) === today || !runsToday(entry.days, now)) continue;
    lastRun.set(key, today);
    try {
      record(entry, await runAction(entry, urls), null);
    } catch (err) {
      record(entry, null, err.message);
    }
  }
}

function start(urls) {
  setInterval(() => tick(urls).catch((err) => console.error('scheduler:', err)), 30 * 1000);
  console.log(`TV scheduler running (wall page ${urls.wallUrl})`);
}

module.exports = { start, runAction, history };
