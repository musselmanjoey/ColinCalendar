// Data for the TV wall page: calendar feeds (Google secret iCal addresses etc.),
// this app's own events, and weather. Settings live in wall.json next to the
// events data file. It's re-read on every request, so edits apply without a restart.

const fs = require('fs');
const path = require('path');
const ical = require('node-ical');

const DEFAULT_CONFIG = {
  // { "name": "Joey", "color": "#5DADE2", "url": "https://calendar.google.com/calendar/ical/.../basic.ics" }
  feeds: [],
  // Show events added in this web app as their own calendar
  appEvents: { name: 'Shared', color: '#82E0AA' },
  weather: { lat: 35.2271, lon: -80.8431 },
  brightness: 1,
  // Evening window for the dark palette, e.g. { "start": "20:00", "end": "06:00" }
  night: null,
  tv: { ip: '', mac: '' },
  // See lib/scheduler.js for the actions
  schedule: [
    { time: '06:30', days: 'daily', action: 'calendar-on' },
    { time: '23:00', days: 'daily', action: 'tv-off-if-calendar' },
  ],
};

function configPath() {
  if (process.env.WALL_CONFIG) return process.env.WALL_CONFIG;
  if (process.env.DATA_FILE) return path.join(path.dirname(process.env.DATA_FILE), 'wall.json');
  return path.join(__dirname, '..', 'wall.json');
}

function loadConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function saveConfig(config) {
  const file = configPath();
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(config, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

// --- Feeds ---

// Just under the TV refresh interval, so an edit shows on the next frame
const FEED_TTL_MS = 50 * 1000;
const feedCache = new Map(); // url -> { at, data, error }

async function fetchFeed(url) {
  const cached = feedCache.get(url);
  if (cached && Date.now() - cached.at < FEED_TTL_MS) return cached;
  try {
    const res = await fetch(url.replace(/^webcal:\/\//i, 'https://'), {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await ical.async.parseICS(await res.text());
    const entry = { at: Date.now(), data, error: null };
    feedCache.set(url, entry);
    return entry;
  } catch (err) {
    // Keep showing the last good copy if a fetch fails
    const entry = { at: Date.now(), data: cached ? cached.data : {}, error: err.message };
    feedCache.set(url, entry);
    return entry;
  }
}

function localDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function text(value) {
  if (value && typeof value === 'object' && 'val' in value) return String(value.val);
  return value == null ? '' : String(value);
}

function feedEvents(data, feed, from, to) {
  const out = [];
  for (const item of Object.values(data)) {
    if (item.type !== 'VEVENT' || item.status === 'CANCELLED') continue;
    const instances = ical.expandRecurringEvent(item, { from, to, expandOngoing: true });
    for (const inst of instances) {
      const allDay = inst.isFullDay;
      out.push({
        title: text(inst.summary) || '(busy)',
        calendar: feed.name,
        color: feed.color,
        allDay,
        // All-day events as local dates (end exclusive); timed events as instants
        start: allDay ? localDate(inst.start) : inst.start.toISOString(),
        end: allDay
          ? localDate(inst.end || new Date(inst.start.getTime() + 86400000))
          : (inst.end || inst.start).toISOString(),
      });
    }
  }
  return out;
}

async function appEventsInRange(getEvents, from, to) {
  const keys = new Set();
  for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= to; d.setMonth(d.getMonth() + 1)) {
    keys.add(`events:${localDate(d).slice(0, 7)}`);
  }
  const months = await Promise.all([...keys].map(getEvents));
  const fromDay = localDate(from);
  const toDay = localDate(to);
  return months.flat().filter((e) => e.date >= fromDay && e.date <= toDay);
}

// --- Weather (Open-Meteo, no key) ---

let weatherCache = { at: 0, key: '', data: null };

async function getWeather({ lat, lon }) {
  const key = `${lat},${lon}`;
  if (weatherCache.key === key && Date.now() - weatherCache.at < 15 * 60 * 1000) return weatherCache.data;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&temperature_unit=fahrenheit&timezone=auto&forecast_days=5';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const data = {
      temp: Math.round(j.current.temperature_2m),
      code: j.current.weather_code,
      days: j.daily.time.map((date, i) => ({
        date,
        code: j.daily.weather_code[i],
        hi: Math.round(j.daily.temperature_2m_max[i]),
        lo: Math.round(j.daily.temperature_2m_min[i]),
        rain: j.daily.precipitation_probability_max[i],
      })),
    };
    weatherCache = { at: Date.now(), key, data };
    return data;
  } catch (err) {
    console.error('weather:', err.message);
    return weatherCache.data;
  }
}

// --- Page payload ---

function minutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function isNight(config, now = new Date()) {
  const n = config.night;
  if (!n || !n.start || !n.end) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  const s = minutes(n.start);
  const e = minutes(n.end);
  return s <= e ? t >= s && t < e : t >= s || t < e;
}

async function wallData(getEvents) {
  const config = loadConfig();
  const now = new Date();
  // Covers a 6-week month grid with room on both sides
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 20);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 15);

  const feeds = await Promise.all(
    config.feeds.filter((f) => f.url).map(async (feed) => {
      const { data, error } = await fetchFeed(feed.url);
      return { feed, events: feedEvents(data, feed, from, to), error };
    }),
  );

  const events = feeds.flatMap((f) => f.events);
  if (config.appEvents) {
    for (const e of await appEventsInRange(getEvents, from, to)) {
      events.push({
        title: e.title,
        calendar: config.appEvents.name,
        color: config.appEvents.color,
        allDay: true,
        start: e.date,
        end: localDate(new Date(new Date(`${e.date}T12:00:00`).getTime() + 86400000)),
      });
    }
  }

  return {
    now: now.toISOString(),
    // Evening: the page switches to its dark palette (night.start-night.end)
    isNight: isNight(config, now),
    // Live page rotates day/week/month; the still TV image shows one view
    rotateSeconds: config.rotateSeconds || 60,
    staticView: config.staticView || 'week',
    // 1-10 (see wall.css); unset = rotate through them every minute while choosing
    theme: config.theme || null,
    calendars: [
      ...config.feeds.filter((f) => f.url).map((f) => ({ name: f.name, color: f.color })),
      ...(config.appEvents ? [config.appEvents] : []),
    ],
    feedErrors: feeds.filter((f) => f.error).map((f) => ({ name: f.feed.name, error: f.error })),
    weather: await getWeather(config.weather),
    events,
  };
}

module.exports = { loadConfig, saveConfig, configPath, wallData, minutes };
