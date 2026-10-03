// Puts the wall calendar on the TV without touching the TV's browser.
//
// The TU7000's browser can't be pointed at a URL remotely, but the TV is a DLNA
// media renderer that will show an image it's told to fetch. So guist renders
// /wall to a JPEG with headless Chrome, serves it at /tv/frame-<n>.jpg, and tells
// the TV to show it (AVTransport SetAVTransportURI + Play).
//
// Every new image makes the TV flash its loading screen, so a new one is pushed
// only when something on it changes (events, weather, the day, an event starting
// or ending, the theme while themes are rotating). The page
// is still checked every minute; unchanged checks cost no flicker. The image has
// no live clock for that reason. If someone switches to something else, the TV
// stops reporting our image and the checks stop.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('./wall');

const DLNA_PORT = 9197;
const AVT = 'urn:schemas-upnp-org:service:AVTransport:1';

let browser = null;
let frame = { n: 0, jpeg: null, at: 0 };
let lastSignature = null;
let refreshTimer = null;
let active = false; // true while we believe the TV is showing our frames

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome-headless-shell');
  if (fs.existsSync(base)) {
    for (const v of fs.readdirSync(base).sort().reverse()) {
      const p = path.join(base, v, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('No headless Chrome found: set CHROME_PATH');
}

async function getBrowser() {
  if (browser && browser.connected) return browser;
  const puppeteer = require('puppeteer-core');
  const exe = chromePath();
  browser = await puppeteer.launch({
    executablePath: exe,
    headless: exe.includes('headless-shell') ? 'shell' : true,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
  });
  return browser;
}

// Renders the wall page and, if it changed (or force), takes a
// 4K JPEG (1920x1080 CSS pixels at 2x) as the next frame. Returns the new frame
// or null when nothing needs pushing.
async function render(wallUrl, force = false) {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    await page.goto(`${wallUrl}?static=1`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction('window.__wallReady === true', { timeout: 30000 });
    const signature = await page.evaluate('window.__wallSignature');
    if (!force && signature === lastSignature) return null;
    // puppeteer 23 returns a Uint8Array; Express would send that as JSON
    const jpeg = Buffer.from(await page.screenshot({ type: 'jpeg', quality: 88 }));
    frame = { n: frame.n + 1, jpeg, at: Date.now() };
    lastSignature = signature;
    return frame;
  } finally {
    await page.close();
  }
}

function currentFrame() {
  return frame;
}

// --- DLNA (UPnP AVTransport) ---

async function soap(action, args = '') {
  const { ip } = loadConfig().tv;
  const body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${AVT}"><InstanceID>0</InstanceID>${args}</u:${action}></s:Body></s:Envelope>`;
  const res = await fetch(`http://${ip}:${DLNA_PORT}/upnp/control/AVTransport1`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${AVT}#${action}"` },
    body,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) {
    const code = (text.match(/<errorCode>(\d+)/) || [])[1];
    const desc = (text.match(/<errorDescription>([^<]*)/) || [])[1];
    throw new Error(`DLNA ${action} failed: ${code || res.status} ${desc || ''}`.trim());
  }
  return text;
}

function xmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function push(frameUrl) {
  const didl =
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    '<item id="0" parentID="-1" restricted="1"><dc:title>Wall Calendar</dc:title>' +
    '<upnp:class>object.item.imageItem.photo</upnp:class>' +
    `<res protocolInfo="http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_LRG">${frameUrl}</res></item></DIDL-Lite>`;
  await soap('SetAVTransportURI', `<CurrentURI>${xmlEscape(frameUrl)}</CurrentURI><CurrentURIMetaData>${xmlEscape(didl)}</CurrentURIMetaData>`);
  try {
    await soap('Play', '<Speed>1</Speed>');
  } catch (err) {
    // 701: the TV already started playing the new image on its own
    if (!/ 701 /.test(err.message)) throw err;
    await new Promise((r) => setTimeout(r, 2000));
    const info = await soap('GetTransportInfo');
    if (!/<CurrentTransportState>PLAYING</.test(info)) throw err;
  }
}

// True when the TV is playing one of our frames
async function showingOurFrame() {
  try {
    const info = await soap('GetTransportInfo');
    const state = (info.match(/<CurrentTransportState>([^<]*)/) || [])[1];
    if (state !== 'PLAYING') return false;
    const media = await soap('GetMediaInfo');
    return /\/tv\/frame-\d+\.jpg/.test(media);
  } catch {
    return false;
  }
}

function frameUrl(baseUrl, n) {
  return `${baseUrl}/tv/frame-${n}.jpg`;
}

// Render and, if needed, push a frame. baseUrl is how the TV reaches this server.
async function showFrame(wallUrl, baseUrl, force = false) {
  const f = await render(wallUrl, force);
  if (!f) return null;
  await push(frameUrl(baseUrl, f.n));
  console.log(`tv-display: pushed frame ${f.n}${force ? '' : ' (content changed)'}`);
  return f.n;
}

function stopRefresh() {
  active = false;
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

// Shows the calendar now and keeps it fresh while it stays on screen.
async function start(wallUrl, baseUrl) {
  stopRefresh();
  await showFrame(wallUrl, baseUrl, true);
  active = true;
  const seconds = Math.max(30, Number(loadConfig().tv.checkSeconds) || 60);
  refreshTimer = setInterval(async () => {
    try {
      if (!(await showingOurFrame())) {
        console.log('tv-display: TV moved off the calendar; stopping refresh');
        return stopRefresh();
      }
      await showFrame(wallUrl, baseUrl);
    } catch (err) {
      console.error('tv-display refresh:', err.message);
    }
  }, seconds * 1000);
  return 'calendar on screen';
}

async function stop() {
  stopRefresh();
  await soap('Stop').catch(() => {});
}

// After a restart: if the TV is still showing one of our frames, pick the
// checks back up so updates keep coming.
async function resumeIfShowing(wallUrl, baseUrl) {
  if (!loadConfig().tv.ip) return;
  if (await showingOurFrame()) {
    console.log('tv-display: calendar still on screen after restart; resuming refresh');
    await start(wallUrl, baseUrl);
  }
}

async function shutdown() {
  stopRefresh();
  if (browser) await browser.close().catch(() => {});
}

module.exports = { start, stop, resumeIfShowing, shutdown, render, currentFrame, showingOurFrame, isActive: () => active };
