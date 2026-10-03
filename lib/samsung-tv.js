// Controls a Samsung Tizen smart TV (2016+) over the LAN:
//  - REST on :8001 for power state, app status and launching apps (no pairing).
//    "Show the calendar" launches our sideloaded app (tv-app/), which opens /wall.
//  - secure WebSocket on :8002 for remote keys. The first
//    connection pops up an "Allow" prompt on the TV; the token it returns is saved
//    in wall.json so it never asks again.
//  - Wake-on-LAN to turn it on from fully off. Needs "Power On with Mobile" (or
//    similar, under Settings > General > Network > Expert Settings) enabled.

const dgram = require('dgram');
const WebSocket = require('ws');
const { loadConfig, saveConfig } = require('./wall');
const display = require('./tv-display');

const APP_NAME = Buffer.from('WallCalendar').toString('base64');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tvConfig() {
  const { tv } = loadConfig();
  if (!tv || !tv.ip) throw new Error('No TV configured: set tv.ip (and tv.mac) in wall.json');
  return tv;
}

async function rest(ip, pathname, method = 'GET') {
  const res = await fetch(`http://${ip}:8001${pathname}`, { method, signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`TV REST ${pathname}: HTTP ${res.status}`);
  const body = await res.text();
  // App launches (POST) answer with a malformed body starting "HTTP/"; the launch still works
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return { raw: body };
  }
}

// 'on' | 'standby' | 'off' (unreachable)
async function powerState() {
  const { ip } = tvConfig();
  try {
    const info = await rest(ip, '/api/v2/');
    // Older models have no PowerState field; answering at all means on
    return (info.device && info.device.PowerState) || 'on';
  } catch {
    return 'off';
  }
}

async function deviceInfo() {
  const { ip } = tvConfig();
  return rest(ip, '/api/v2/');
}

// Sends one round of Wake-on-LAN packets (broadcast + direct, ports 9 and 7).
// Over Wi-Fi a single packet is often missed, so callers repeat this.
function wake() {
  const { mac, ip } = tvConfig();
  if (!mac) throw new Error('tv.mac is not set in wall.json; needed to turn the TV on');
  const hex = mac.replace(/[^0-9a-f]/gi, '');
  const packet = Buffer.from('ff'.repeat(6) + hex.repeat(16), 'hex');
  const targets = [['255.255.255.255', 9], ['192.168.1.255', 9], ['255.255.255.255', 7], ['192.168.1.255', 7], [ip, 9]];
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    sock.bind(() => {
      sock.setBroadcast(true);
      let pending = targets.length;
      for (const [host, port] of targets) {
        sock.send(packet, port, host, () => {
          if (--pending === 0) { sock.close(); resolve(); }
        });
      }
    });
  });
}

// Opens the remote-control channel, runs fn(send), then closes.
function withRemote(fn) {
  const tv = tvConfig();
  const config = loadConfig();
  const token = tv.token ? `&token=${tv.token}` : '';
  const url = `wss://${tv.ip}:8002/api/v2/channels/samsung.remote.control?name=${APP_NAME}${token}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 5000 });
    // Long timeout: the first connection waits for someone to press Allow on the TV
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('TV did not answer (pairing prompt not accepted?)')); }, 30000);
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    ws.on('message', async (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.event === 'ms.channel.unauthorized') {
        clearTimeout(timer); ws.close();
        return reject(new Error('TV refused the connection (pairing denied)'));
      }
      if (msg.event !== 'ms.channel.connect') return;
      clearTimeout(timer);
      if (msg.data && msg.data.token && msg.data.token !== tv.token) {
        config.tv = { ...config.tv, token: msg.data.token };
        saveConfig(config);
      }
      try {
        const send = (obj) => ws.send(JSON.stringify(obj));
        const result = await fn(send);
        await sleep(500);
        ws.close();
        resolve(result);
      } catch (err) {
        ws.close();
        reject(err);
      }
    });
  });
}

function sendKey(key) {
  return withRemote((send) => {
    send({
      method: 'ms.remote.control',
      params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' },
    });
  });
}

async function openApp(appId) {
  const { ip } = tvConfig();
  await rest(ip, `/api/v2/applications/${appId}`, 'POST');
  return `opened ${appId}`;
}

async function waitForOn(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if ((await powerState()) === 'on') return true;
    await sleep(2000);
  }
  return false;
}

// From fully off the TV drops off the network a few seconds after standby.
// Repeated Wake-on-LAN brings its network up into "standby" (screen still off),
// then the remote's Power key turns the screen on.
async function ensureOn() {
  const initial = await powerState();
  if (initial === 'on') return;

  let state = initial;
  for (let i = 0; i < 20 && state === 'off'; i++) {
    await wake();
    await sleep(1500);
    state = await powerState();
  }
  if (state === 'off') throw new Error('TV did not wake up (is "Power On with Mobile" enabled?)');

  if (state === 'standby') await sendKey('KEY_POWER');
  if (!(await waitForOn(30000))) throw new Error(`TV did not turn on (was ${initial})`);
  await sleep(4000); // let the home screen settle before showing anything
}

// Turns the TV on (if needed) and opens an app, e.g. YouTube or Netflix.
async function showApp(appId) {
  await ensureOn();
  display.stop().catch(() => {});
  return openApp(appId);
}

// Our Tizen app (tv-app/), which shows the live /wall page full screen
const WALL_APP = 'WallCal001.WallCalendar';

async function appVisible() {
  const { ip } = tvConfig();
  try {
    return Boolean((await rest(ip, '/api/v2/applications/' + WALL_APP)).visible);
  } catch {
    return false; // not installed (e.g. developer mode reset by a firmware update)
  }
}

// Turns the TV on and opens the wall calendar app. If the app can't be opened,
// falls back to pushing the calendar as a picture over DLNA (tv-display.js).
async function showCalendar(wallUrl, baseUrl) {
  await ensureOn();
  try {
    display.stop().catch(() => {});
    await openApp(WALL_APP);
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      if (await appVisible()) return 'calendar app on screen';
    }
    throw new Error('app did not come up');
  } catch (err) {
    console.log('wall app unavailable (' + err.message + '); falling back to picture mode');
    return display.start(wallUrl, baseUrl);
  }
}

async function turnOff() {
  display.stop().catch(() => {});
  if ((await powerState()) !== 'on') return 'already off';
  await sendKey('KEY_POWER');
  return 'off';
}

// Only turns off when the calendar (app or pushed picture) is what's on screen, so it never
// cuts off a show. If the TV can't report that, it leaves the TV on.
async function turnOffIfShowingCalendar() {
  if ((await powerState()) !== 'on') return 'already off';
  if (!(await appVisible()) && !(await display.showingOurFrame())) return 'left on (something else is on screen)';
  display.stop().catch(() => {});
  await sendKey('KEY_POWER');
  return 'off';
}

// Opens and closes the remote channel; the first time, the TV asks to Allow.
function pair() {
  return withRemote(() => 'paired');
}

module.exports = { pair, ensureOn, showCalendar, appVisible, powerState, deviceInfo, wake, sendKey, openApp, showApp, turnOff, turnOffIfShowingCalendar };
