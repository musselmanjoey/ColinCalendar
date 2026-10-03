const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(express.json());

// --- Storage ---
// Uses Upstash Redis in production. Vercel's Upstash integration injects
// KV_REST_API_URL/TOKEN; a direct Upstash setup uses UPSTASH_REDIS_REST_URL/TOKEN.
// Otherwise, if DATA_FILE is set (self-hosted on guist), events persist to that
// JSON file. With neither, an in-memory store is used (local dev).

let redis;
const DATA_FILE = process.env.DATA_FILE;
let memoryStore = {};
if (DATA_FILE && fs.existsSync(DATA_FILE)) {
  memoryStore = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveDataFile() {
  // Write to a temp file and rename, so a crash mid-write can't corrupt the data
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(memoryStore, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    if (!redis) {
      const { Redis } = require('@upstash/redis');
      redis = new Redis({ url, token });
    }
    return redis;
  }
  return null;
}

async function getEvents(key) {
  const r = getRedis();
  if (r) return (await r.get(key)) || [];
  return memoryStore[key] || [];
}

async function setEvents(key, events) {
  const r = getRedis();
  if (r) {
    await r.set(key, events);
  } else {
    memoryStore[key] = events;
    if (DATA_FILE) saveDataFile();
  }
}

// --- Routes ---

// GET /api/events?month=2026-02
app.get('/api/events', async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month param required (YYYY-MM)' });
    }
    const events = await getEvents(`events:${month}`);
    res.json({ events });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// POST /api/events
app.post('/api/events', async (req, res) => {
  try {
    const { date, title } = req.body;
    if (!date || !title) {
      return res.status(400).json({ error: 'date and title required' });
    }
    const month = date.slice(0, 7);
    const event = { id: crypto.randomUUID(), title, date };
    const events = await getEvents(`events:${month}`);
    events.push(event);
    await setEvents(`events:${month}`, events);
    res.json({ event });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// DELETE /api/events/:id?month=2026-02
app.delete('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { month } = req.query;
    if (!month) {
      return res.status(400).json({ error: 'month query param required' });
    }
    const key = `events:${month}`;
    const events = await getEvents(key);
    const filtered = events.filter(e => e.id !== id);
    await setEvents(key, filtered);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// --- ICS feed (read by the wall display) ---

function icsEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545: lines longer than 75 octets continue on a line starting with a space
function icsFold(line) {
  const parts = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  parts.push(rest);
  return parts.join('\r\n ');
}

function icsDate(isoDate) {
  return isoDate.replace(/-/g, '');
}

function nextDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function monthKeys(fromOffset, toOffset) {
  const now = new Date();
  const keys = [];
  for (let i = fromOffset; i <= toOffset; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    keys.push(`events:${d.toISOString().slice(0, 7)}`);
  }
  return keys;
}

function tokenMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// GET /api/calendar.ics?token=...
// All-day events from 3 months back to 12 months ahead. If CALENDAR_FEED_TOKEN
// is set, the token query param must match it.
app.get('/api/calendar.ics', async (req, res) => {
  try {
    const expected = process.env.CALENDAR_FEED_TOKEN;
    if (expected && !tokenMatches(req.query.token, expected)) {
      return res.status(404).send('Not found');
    }

    const months = await Promise.all(monthKeys(-3, 12).map(getEvents));
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ColinCalendar//Shared//EN',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:Shared',
    ];
    for (const event of months.flat()) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${event.id}@colincalendar`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(event.date)}`,
        `DTEND;VALUE=DATE:${icsDate(nextDay(event.date))}`,
        `SUMMARY:${icsEscape(event.title)}`,
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(lines.map(icsFold).join('\r\n') + '\r\n');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to build calendar');
  }
});

// --- TV wall page + TV control ---

const wall = require('../lib/wall');
const tv = require('../lib/samsung-tv');
const scheduler = require('../lib/scheduler');

const PORT = process.env.PORT || 3000;
const WALL_URL = process.env.WALL_URL || `http://localhost:${PORT}/wall`;

app.get('/wall', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'wall.html'));
});

app.get('/api/wall/data', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await wall.wallData(getEvents));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load wall data' });
  }
});

// TV control needs the same token as the feed. GET so it works from a phone
// bookmark or shortcut: /api/tv/calendar-on?token=...
function requireToken(req, res, next) {
  const expected = process.env.CALENDAR_FEED_TOKEN;
  if (expected && !tokenMatches(req.query.token, expected)) return res.status(404).send('Not found');
  next();
}

app.get('/api/tv/status', requireToken, async (req, res) => {
  try {
    const state = await tv.powerState();
    res.json({
      power: state,
      calendarOnScreen: state === 'on' ? await tv.browserVisible() : false,
      schedule: wall.loadConfig().schedule,
      recentRuns: scheduler.history,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const TV_ACTIONS = {
  pair: () => tv.pair(),
  'calendar-on': () => tv.showPage(WALL_URL),
  'tv-off': () => tv.turnOff(),
  'tv-off-if-calendar': () => tv.turnOffIfShowingCalendar(),
  'open-url': (req) => tv.showPage(req.query.url),
  key: (req) => tv.sendKey(req.query.key),
};

app.get('/api/tv/:action', requireToken, async (req, res) => {
  const action = TV_ACTIONS[req.params.action];
  if (!action) return res.status(404).json({ error: `unknown action; try ${Object.keys(TV_ACTIONS).join(', ')}` });
  try {
    res.json({ ok: true, result: (await action(req)) || 'done' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Local dev: serve static files and start server
if (require.main === module) {
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));
  scheduler.start(WALL_URL);
}

module.exports = app;
