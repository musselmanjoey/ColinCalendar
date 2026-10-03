// Controls a Samsung Tizen smart TV (2016+) over the LAN:
//  - REST on :8001 for power state and app status (no pairing)
//  - secure WebSocket on :8002 for remote keys and opening the browser. The first
//    connection pops up an "Allow" prompt on the TV; the token it returns is saved
//    in wall.json so it never asks again.
//  - Wake-on-LAN to turn it on from fully off. Needs "Power On with Mobile" (or
//    similar, under Settings > General > Network > Expert Settings) enabled.

const dgram = require('dgram');
const WebSocket = require('ws');
const { loadConfig, saveConfig } = require('./wall');

const APP_NAME = Buffer.from('WallCalendar').toString('base64');
const BROWSER_APP = 'org.tizen.browser';

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
  return body ? JSON.parse(body) : {};
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

function wake() {
  const { mac } = tvConfig();
  if (!mac) throw new Error('tv.mac is not set in wall.json; needed to turn the TV on');
  const hex = mac.replace(/[^0-9a-f]/gi, '');
  const packet = Buffer.from('ff'.repeat(6) + hex.repeat(16), 'hex');
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    sock.bind(() => {
      sock.setBroadcast(true);
      let pending = 2;
      const done = (err) => {
        if (err) { sock.close(); return reject(err); }
        if (--pending === 0) { sock.close(); resolve(); }
      };
      sock.send(packet, 9, '255.255.255.255', done);
      sock.send(packet, 9, '192.168.1.255', done);
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

function openUrl(url) {
  return withRemote((send) => {
    send({
      method: 'ms.channel.emit',
      params: {
        event: 'ed.apps.launch',
        to: 'host',
        data: { appId: BROWSER_APP, action_type: 'NATIVE_LAUNCH', metaTag: url },
      },
    });
  });
}

async function browserVisible() {
  const { ip } = tvConfig();
  try {
    const app = await rest(ip, `/api/v2/applications/${BROWSER_APP}`);
    return Boolean(app.visible);
  } catch {
    return null; // unknown on this model
  }
}

async function waitForOn(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if ((await powerState()) === 'on') return true;
    await sleep(2000);
  }
  return false;
}

// Turns the TV on (if needed) and shows the given page.
async function showPage(url) {
  let state = await powerState();
  if (state !== 'on') {
    if (loadConfig().tv.mac) await wake();
    // In network standby the TV answers on :8002 and KEY_POWER wakes it
    if (state === 'standby') await sendKey('KEY_POWER').catch(() => {});
    if (!(await waitForOn(30000))) throw new Error(`TV did not turn on (was ${state})`);
    await sleep(4000); // let the home screen settle before launching apps
  }
  await openUrl(url);
  return 'shown';
}

async function turnOff() {
  if ((await powerState()) !== 'on') return 'already off';
  await sendKey('KEY_POWER');
  return 'off';
}

// Only turns off when the calendar (browser) is what's on screen, so it never
// cuts off a show. If the TV can't report that, it leaves the TV on.
async function turnOffIfShowingCalendar() {
  if ((await powerState()) !== 'on') return 'already off';
  const visible = await browserVisible();
  if (visible !== true) return visible === false ? 'left on (something else is on screen)' : 'left on (cannot tell what is on screen)';
  await sendKey('KEY_POWER');
  return 'off';
}

// Opens and closes the remote channel; the first time, the TV asks to Allow.
function pair() {
  return withRemote(() => 'paired');
}

module.exports = { pair, powerState, deviceInfo, wake, sendKey, openUrl, browserVisible, showPage, turnOff, turnOffIfShowingCalendar };
