#!/usr/bin/env node
// Builds MagicMirror's config.js and custom.css from the templates + wallcal.env.
//
//   node render-config.js                  -> writes into ~/MagicMirror (the Pi)
//   node render-config.js --out ./build    -> writes into ./build (laptop test)
//   node render-config.js --mm /path/to/MagicMirror
//
// No dependencies, so it runs anywhere Node does.

const fs = require('fs');
const os = require('os');
const path = require('path');

const here = __dirname;
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

function loadEnv(file) {
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file}. Copy wallcal.env.example to wallcal.env and fill it in.`);
    process.exit(1);
  }
  const env = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    env[line.slice(0, eq).trim()] = value;
  }
  return env;
}

const env = loadEnv(flag('--env') || path.join(here, 'wallcal.env'));

const calendars = ['JOEY', 'PARTNER', 'SHARED', 'HOLIDAYS']
  .map((prefix) => ({
    name: env[`${prefix}_NAME`] || prefix.toLowerCase(),
    color: env[`${prefix}_COLOR`] || '#FFFFFF',
    // iCloud hands out webcal:// links; the calendar module wants https://
    url: (env[`${prefix}_ICS_URL`] || '').replace(/^webcal:\/\//i, 'https://'),
  }))
  .filter((c) => c.url);

if (calendars.length === 0) {
  console.error('No calendar URLs set in wallcal.env; the month grid would be empty.');
  process.exit(1);
}
for (const c of calendars) {
  if (!/^https?:\/\//.test(c.url)) {
    console.error(`${c.name}: URL must start with https:// or webcal:// (got "${c.url.slice(0, 20)}...")`);
    process.exit(1);
  }
}

const lat = Number(env.WEATHER_LAT || 35.2271);
const lon = Number(env.WEATHER_LON || -80.8431);
const brightness = Number(env.BRIGHTNESS || 0.8);
if ([lat, lon, brightness].some(Number.isNaN)) {
  console.error('WEATHER_LAT, WEATHER_LON and BRIGHTNESS must be numbers.');
  process.exit(1);
}

const configJs = fs
  .readFileSync(path.join(here, 'config.template.js'), 'utf8')
  .replace(/__CALENDARS__/g, JSON.stringify(calendars, null, '\t').replace(/\n/g, '\n\t\t\t\t'))
  .replace(/__LAT__/g, String(lat))
  .replace(/__LON__/g, String(lon));

const customCss = fs
  .readFileSync(path.join(here, 'custom.css'), 'utf8')
  .replace(/--wallcal-brightness:\s*[\d.]+/, `--wallcal-brightness: ${brightness}`);

const out = flag('--out');
const mm = flag('--mm') || path.join(os.homedir(), 'MagicMirror');
const configPath = out ? path.join(out, 'config.js') : path.join(mm, 'config', 'config.js');
const cssPath = out ? path.join(out, 'custom.css') : path.join(mm, 'css', 'custom.css');

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.mkdirSync(path.dirname(cssPath), { recursive: true });
if (!out && fs.existsSync(configPath)) {
  const backup = `${configPath}.bak-${Date.now()}`;
  fs.copyFileSync(configPath, backup);
  console.log(`Backed up existing config to ${backup}`);
}
fs.writeFileSync(configPath, configJs);
fs.writeFileSync(cssPath, customCss);

// Sanity check: the result must load as a module.
delete require.cache[require.resolve(path.resolve(configPath))];
const loaded = require(path.resolve(configPath));
console.log(`Wrote ${configPath} (${loaded.modules.length} modules, calendars: ${calendars.map((c) => c.name).join(', ')})`);
console.log(`Wrote ${cssPath} (brightness ${brightness})`);
