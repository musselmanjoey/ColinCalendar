const express = require('express');
const path = require('path');
const crypto = require('crypto');

const wall = require('../lib/wall');
const tv = require('../lib/samsung-tv');
const scheduler = require('../lib/scheduler');
const display = require('../lib/tv-display');

const app = express();

function tokenMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const PORT = process.env.PORT || 3000;
const WALL_URL = process.env.WALL_URL || `http://localhost:${PORT}/wall`;
// How the TV reaches this server (frames are fetched from here)
const BASE_URL = WALL_URL.replace(/\/wall$/, '');

app.get('/', (req, res) => res.redirect('/wall'));

app.get('/wall', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'wall.html'));
});

// Last device to load the wall page, so /api/tv/status can show the TV is really on it
let lastWallView = null;

app.get('/api/wall/data', async (req, res) => {
  try {
    if (!req.query.static) {
      lastWallView = {
        at: new Date().toString(), ip: req.ip, userAgent: req.get('user-agent'),
        size: req.query.w ? req.query.w + 'x' + req.query.h + ' @' + req.query.dpr : null,
      };
    }
    res.set('Cache-Control', 'no-store');
    res.json(await wall.wallData());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load wall data' });
  }
});

// TV control needs CONTROL_TOKEN. GET so it works from a phone bookmark or
// shortcut: /api/tv/calendar-on?token=...
function requireToken(req, res, next) {
  const expected = process.env.CONTROL_TOKEN;
  if (expected && !tokenMatches(req.query.token, expected)) return res.status(404).send('Not found');
  next();
}

// The current calendar frame for the TV (DLNA image). Any frame number returns
// the latest; the number only exists so the TV sees a new URL each refresh.
app.get(/^\/tv\/frame-\d+\.jpg$/, (req, res) => {
  const { jpeg } = display.currentFrame();
  if (!jpeg) return res.status(404).end();
  // setHeader, not res.set: Express appends "; charset=utf-8", which the TV rejects
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('contentFeatures.dlna.org', 'DLNA.ORG_PN=JPEG_LRG;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=00D00000000000000000000000000000');
  res.setHeader('transferMode.dlna.org', 'Interactive');
  res.setHeader('Content-Length', jpeg.length);
  res.end(req.method === 'HEAD' ? undefined : jpeg);
});

app.get('/api/tv/status', requireToken, async (req, res) => {
  try {
    const state = await tv.powerState();
    res.json({
      power: state,
      calendarOnScreen: state === 'on' ? (await tv.appVisible()) || (await display.showingOurFrame()) : false,
      lastWallView,
      schedule: wall.loadConfig().schedule,
      recentRuns: scheduler.history,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const TV_ACTIONS = {
  pair: () => tv.pair(),
  'calendar-on': () => tv.showCalendar(WALL_URL, BASE_URL),
  'tv-off': () => tv.turnOff(),
  'tv-off-if-calendar': () => tv.turnOffIfShowingCalendar(),
  'open-app': (req) => tv.showApp(req.query.app),
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

app.use(express.static(path.join(__dirname, '..', 'public')));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));
  scheduler.start({ wallUrl: WALL_URL, baseUrl: BASE_URL });
  display.resumeIfShowing(WALL_URL, BASE_URL).catch((err) => console.error('resume:', err.message));

  // Close headless Chrome on stop so systemd isn't left waiting on it
  process.on('SIGTERM', async () => {
    await display.shutdown();
    process.exit(0);
  });
}

module.exports = app;
