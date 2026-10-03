/* TV wall calendar. Written in ES5 on purpose: Samsung TV browsers can be old
 * Chromium builds, so no arrow functions, async/await, padStart, etc.
 *
 * Three views rotate on the right: day (timeline), week (next 7 days) and
 * month (grid). The left column (clock, weather, today/tomorrow) stays put. */
(function () {
  'use strict';

  var DATA_EVERY_MS = 60 * 1000; // the server re-reads Google every ~50 s
  var RELOAD_EVERY_MS = 6 * 60 * 60 * 1000; // picks up page changes
  var MAX_LINES = 4; // month cell
  var MAX_WEEK_ITEMS = 7; // week column
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEATHER = {
    0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog',
    51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow', 80: 'Showers', 81: 'Showers',
    82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Storms', 96: 'Storms', 99: 'Storms'
  };
  var VIEWS = ['day', 'week', 'month'];
  // Must match the body[data-theme] blocks in wall.css
  var THEMES = ['Midnight', 'Dusk', 'Sunrise'];
  var PAGE_VERSION = 'v2';

  // Simple flat weather icons (inline SVG, no external files)
  var SUN = '<circle cx="32" cy="32" r="11" fill="#fbbf24"/><g stroke="#fbbf24" stroke-width="4" stroke-linecap="round">' +
    '<path d="M32 6v7M32 51v7M6 32h7M51 32h7M13.6 13.6l5 5M45.4 45.4l5 5M13.6 50.4l5-5M45.4 18.6l5-5"/></g>';
  var CLOUD = function (fill) {
    return '<path d="M18 50h28a11 11 0 0 0 0-22 15 15 0 0 0-28.6 4A9 9 0 0 0 18 50z" fill="' + fill + '"/>';
  };
  var ICONS = {
    clear: SUN,
    partly: '<g transform="translate(-6 -8) scale(0.8)">' + SUN + '</g>' + CLOUD('#cbd5e1'),
    cloud: CLOUD('#94a3b8'),
    fog: CLOUD('#94a3b8') + '<g stroke="#94a3b8" stroke-width="3.5" stroke-linecap="round"><path d="M12 56h40M18 61h28"/></g>',
    rain: '<g transform="translate(0 -6)">' + CLOUD('#94a3b8') + '</g><g stroke="#3b82f6" stroke-width="3.5" stroke-linecap="round">' +
      '<path d="M22 50l-3 7M32 50l-3 7M42 50l-3 7"/></g>',
    snow: '<g transform="translate(0 -6)">' + CLOUD('#cbd5e1') + '</g><g fill="#7dd3fc">' +
      '<circle cx="21" cy="54" r="3"/><circle cx="32" cy="58" r="3"/><circle cx="43" cy="54" r="3"/></g>',
    storm: '<g transform="translate(0 -6)">' + CLOUD('#64748b') + '</g><path d="M34 44l-8 11h7l-3 9 10-13h-7l3-7z" fill="#facc15"/>'
  };
  function iconKind(code) {
    if (code <= 1) return 'clear';
    if (code === 2) return 'partly';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 95) return 'storm';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    return 'rain';
  }
  function weatherIcon(code) {
    return '<svg viewBox="0 0 64 64">' + ICONS[iconKind(code)] + '</svg>';
  }

  var data = null;
  // ?static=1: rendered to an image for the TV (lib/tv-display.js), so no motion
  var STATIC = /[?&]static=1/.test(location.search);
  // ?view=day|week|month pins one view (no rotation)
  var viewMatch = /[?&]view=(day|week|month)/.exec(location.search);
  var pinnedView = viewMatch ? viewMatch[1] : null;
  var view = pinnedView || 'day';
  var rotations = 0;

  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDay(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var c = new Date(d.getTime()); c.setDate(c.getDate() + n); return c; }
  function startOfToday() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function shortTime(d) {
    var h = d.getHours(), m = d.getMinutes();
    var s = (h % 12 || 12) + (m ? ':' + pad(m) : '');
    return s + (h < 12 ? 'a' : 'p');
  }
  function timeRange(e) {
    var s = new Date(e.start), en = new Date(e.end);
    return en - s > 0 ? shortTime(s) + '–' + shortTime(en) : shortTime(s);
  }

  // Events touching a given local day, all-day first, then by start time
  function eventsOn(day) {
    if (!data) return [];
    var key = dayKey(day);
    var dayStart = day.getTime();
    var dayEnd = addDays(day, 1).getTime();
    var out = [];
    for (var i = 0; i < data.events.length; i++) {
      var e = data.events[i];
      if (e.allDay) {
        if (e.start <= key && e.end > key) out.push(e);
      } else {
        var s = new Date(e.start).getTime();
        if (s >= dayStart && s < dayEnd) out.push(e);
      }
    }
    out.sort(function (a, b) {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.allDay ? (a.title < b.title ? -1 : 1) : new Date(a.start) - new Date(b.start);
    });
    return out;
  }

  // --- Left column ---

  function renderClock() {
    var now = new Date();
    var h = now.getHours();
    $('clock').innerHTML = (h % 12 || 12) + ':' + pad(now.getMinutes()) +
      '<span class="ampm">' + (h < 12 ? 'AM' : 'PM') + '</span>';
    $('date').textContent = LONG_DAYS[now.getDay()] + ', ' + MONTHS[now.getMonth()] + ' ' + now.getDate();
  }

  function renderWeather() {
    var w = data && data.weather;
    if (!w) { $('weather').innerHTML = ''; return; }
    var html = '<div class="now">' + weatherIcon(w.code) + '<span class="temp">' + w.temp + '&deg;</span>' +
      '<span class="desc">' + esc(WEATHER[w.code] || '') + '</span></div><div class="days">';
    for (var i = 0; i < w.days.length; i++) {
      var d = w.days[i];
      html += '<div class="day"><b>' + (i === 0 ? 'Today' : DAYS[parseDay(d.date).getDay()]) + '</b>' +
        weatherIcon(d.code) + '<span class="hi">' + d.hi + '&deg;</span> ' + d.lo + '&deg;' +
        '<span class="rain">' + (d.rain >= 30 ? d.rain + '%' : '') + '</span></div>';
    }
    $('weather').innerHTML = html + '</div>';
  }

  function renderAgenda(listId, day, isToday) {
    var events = eventsOn(day);
    var now = Date.now();
    if (!events.length) { $(listId).innerHTML = '<li class="none">Nothing scheduled</li>'; return; }
    var html = '';
    for (var i = 0; i < events.length && i < 8; i++) {
      var e = events[i];
      var cls = '';
      var when = 'All day';
      if (!e.allDay) {
        var s = new Date(e.start), en = new Date(e.end);
        when = shortTime(s);
        if (isToday && en.getTime() < now) cls = 'past';
        else if (isToday && s.getTime() - now < 60 * 60 * 1000) cls = 'soon';
      }
      html += '<li class="' + cls + '"><span class="dot" style="background:' + esc(e.color) + '"></span>' +
        '<span class="when">' + when + '</span><span class="what">' + esc(e.title) + '</span></li>';
    }
    if (events.length > 8) html += '<li class="none">+' + (events.length - 8) + ' more</li>';
    $(listId).innerHTML = html;
  }

  function renderLegend() {
    var html = '';
    var cals = (data && data.calendars) || [];
    for (var i = 0; i < cals.length; i++) {
      html += '<span><i style="background:' + esc(cals[i].color) + '"></i>' + esc(cals[i].name) + '</span>';
    }
    $('legend').innerHTML = html;
    var errs = (data && data.feedErrors) || [];
    var msg = [];
    for (var j = 0; j < errs.length; j++) msg.push(errs[j].name + ': ' + errs[j].error);
    $('status').textContent = msg.length ? 'Not updating - ' + msg.join('; ') : '';
  }

  // --- Day view: today's timeline ---

  // Gives overlapping events side-by-side lanes: [{e, lane, lanes}]
  function layoutLanes(events) {
    var items = [];
    var cluster = [], clusterEnd = 0, laneEnds = [];
    function flush() {
      for (var k = 0; k < cluster.length; k++) cluster[k].lanes = laneEnds.length;
      cluster = []; laneEnds = [];
    }
    for (var i = 0; i < events.length; i++) {
      var s = new Date(events[i].start).getTime();
      var en = Math.max(new Date(events[i].end).getTime(), s + 30 * 60000);
      if (cluster.length && s >= clusterEnd) flush();
      var lane = 0;
      while (lane < laneEnds.length && laneEnds[lane] > s) lane++;
      laneEnds[lane] = en;
      var item = { e: events[i], lane: lane, lanes: 1, s: s, en: en };
      cluster.push(item);
      items.push(item);
      clusterEnd = cluster.length === 1 ? en : Math.max(clusterEnd, en);
    }
    flush();
    return items;
  }

  function renderDay() {
    var today = startOfToday();
    var events = eventsOn(today);
    var allDay = [], timed = [], i;
    for (i = 0; i < events.length; i++) (events[i].allDay ? allDay : timed).push(events[i]);

    var html = '<div class="allday-row">';
    for (i = 0; i < allDay.length; i++) {
      html += '<span class="chip" style="background:' + esc(allDay[i].color) + '">' + esc(allDay[i].title) + '</span>';
    }
    html += '</div>';

    // Show 7 AM to 11 PM, stretched to fit anything earlier or later
    var startH = 7, endH = 23;
    for (i = 0; i < timed.length; i++) {
      var s = new Date(timed[i].start), en = new Date(timed[i].end);
      startH = Math.min(startH, s.getHours());
      endH = Math.max(endH, en.getDate() !== s.getDate() ? 24 : en.getHours() + (en.getMinutes() ? 1 : 0));
    }
    var span = endH - startH;
    var t0 = today.getTime() + startH * 3600000;

    html += '<div class="timeline">';
    for (var h = startH; h < endH; h++) {
      html += '<div class="hour" style="top:' + ((h - startH) / span * 100) + '%"><span>' +
        ((h % 12) || 12) + (h < 12 ? ' AM' : ' PM') + '</span></div>';
    }
    html += '<div class="blocks">';
    var items = layoutLanes(timed);
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var top = Math.max(0, (it.s - t0) / (span * 3600000) * 100);
      var height = Math.max(3.2, (Math.min(it.en, t0 + span * 3600000) - Math.max(it.s, t0)) / (span * 3600000) * 100);
      var past = new Date(it.e.end).getTime() < Date.now() ? ' past' : '';
      html += '<div class="block' + past + '" style="top:' + top + '%;height:' + height + '%;left:' +
        (it.lane / it.lanes * 100) + '%;width:calc(' + (100 / it.lanes) + '% - 0.4vw);border-color:' + esc(it.e.color) +
        ';background:' + esc(it.e.color) + '22"><b>' + esc(it.e.title) + '</b><span>' + timeRange(it.e) +
        ' &middot; ' + esc(it.e.calendar) + '</span></div>';
    }
    html += '</div></div>';
    if (!events.length) html += '<div class="empty">Nothing on the calendar today</div>';
    $('view-day').innerHTML = html;
    dayRange = { t0: t0, span: span };
  }

  var dayRange = null;
  // Drawn separately so it doesn't count as a content change (it moves every minute)
  function renderNowLine() {
    var old = document.querySelector('.nowline');
    if (old) old.parentNode.removeChild(old);
    if (!dayRange) return;
    var pct = (Date.now() - dayRange.t0) / (dayRange.span * 3600000) * 100;
    if (pct < 0 || pct > 100) return;
    var line = document.createElement('div');
    line.className = 'nowline';
    line.style.top = pct + '%';
    var tl = document.querySelector('#view-day .timeline');
    if (tl) tl.appendChild(line);
  }

  // --- Week view: the next 7 days ---

  function renderWeek() {
    var today = startOfToday();
    var html = '';
    for (var d = 0; d < 7; d++) {
      var day = addDays(today, d);
      var label = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : LONG_DAYS[day.getDay()];
      html += '<div class="wcol' + (d === 0 ? ' today' : '') + (day.getDay() === 0 || day.getDay() === 6 ? ' weekend' : '') + '">' +
        '<div class="whead"><b>' + label + '</b><span>' + SHORT_MONTHS[day.getMonth()] + ' ' + day.getDate() + '</span></div>';
      var events = eventsOn(day);
      var shown = events.length > MAX_WEEK_ITEMS ? MAX_WEEK_ITEMS - 1 : events.length;
      for (var k = 0; k < shown; k++) {
        var e = events[k];
        if (e.allDay) {
          html += '<div class="witem allday" style="background:' + esc(e.color) + '">' + esc(e.title) + '</div>';
        } else {
          html += '<div class="witem" style="border-color:' + esc(e.color) + '"><span class="t">' + timeRange(e) +
            '</span><span class="w">' + esc(e.title) + '</span></div>';
        }
      }
      if (events.length > shown) html += '<div class="more">+' + (events.length - shown) + ' more</div>';
      if (!events.length) html += '<div class="wfree">Free</div>';
      html += '</div>';
    }
    $('view-week').innerHTML = html;
  }

  // --- Month view ---

  function renderMonth() {
    var today = startOfToday();
    var first = new Date(today.getFullYear(), today.getMonth(), 1);
    var start = addDays(first, -first.getDay());
    var weeks = Math.ceil((first.getDay() + new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()) / 7);

    var html = '<div class="weekdays">';
    for (var d = 0; d < 7; d++) html += '<div>' + DAYS[d] + '</div>';
    html += '</div><div class="grid">';
    for (var w = 0; w < weeks; w++) {
      html += '<div class="week">';
      for (var i = 0; i < 7; i++) {
        var day = addDays(start, w * 7 + i);
        var cls = 'cell' + (day.getMonth() !== today.getMonth() ? ' other' : '') +
          (day.getTime() === today.getTime() ? ' today' : '');
        html += '<div class="' + cls + '"><div class="num">' + day.getDate() + '</div>';
        var events = eventsOn(day);
        var shown = events.length > MAX_LINES ? MAX_LINES - 1 : events.length;
        for (var k = 0; k < shown; k++) {
          var e = events[k];
          if (e.allDay) {
            html += '<div class="ev allday" style="background:' + esc(e.color) + '">' + esc(e.title) + '</div>';
          } else {
            html += '<div class="ev"><span class="bar" style="background:' + esc(e.color) + '"></span>' +
              '<span class="t">' + shortTime(new Date(e.start)) + '</span>' + esc(e.title) + '</div>';
          }
        }
        if (events.length > shown) html += '<div class="more">+' + (events.length - shown) + ' more</div>';
        html += '</div>';
      }
      html += '</div>';
    }
    $('view-month').innerHTML = html + '</div>';
  }

  // --- Switching views ---

  function viewTitle(name) {
    var today = startOfToday();
    if (name === 'day') return 'Today';
    if (name === 'week') {
      var end = addDays(today, 6);
      return 'This week <small>' + SHORT_MONTHS[today.getMonth()] + ' ' + today.getDate() + ' – ' +
        SHORT_MONTHS[end.getMonth()] + ' ' + end.getDate() + '</small>';
    }
    return MONTHS[today.getMonth()] + ' ' + today.getFullYear();
  }

  function showView(name) {
    view = name;
    for (var i = 0; i < VIEWS.length; i++) {
      $('view-' + VIEWS[i]).className = 'view' + (VIEWS[i] === name ? ' active' : '');
    }
    $('view-title').innerHTML = viewTitle(name);
  }

  // A fixed theme from settings, or (while choosing) a new one every minute
  var themeMatch = /[?&]theme=(\d+)/.exec(location.search);
  function currentTheme() {
    if (themeMatch) return +themeMatch[1];
    if (data && data.theme) return +data.theme;
    return Math.floor(Date.now() / 60000) % THEMES.length + 1;
  }
  function applyTheme() {
    var t = currentTheme();
    if (document.body.getAttribute('data-theme') !== String(t)) document.body.setAttribute('data-theme', String(t));
    $('version').innerHTML = 'Theme <b>' + t + ' &middot; ' + THEMES[t - 1] + '</b> &nbsp;&middot;&nbsp; ' + PAGE_VERSION;
  }

  function renderAll() {
    renderClock();
    renderWeather();
    var today = startOfToday();
    renderAgenda('today', today, true);
    renderAgenda('tomorrow', addDays(today, 1), false);
    renderDay();
    renderWeek();
    renderMonth();
    renderLegend();
    if (data) document.body.style.filter = 'brightness(' + data.brightness + ')';
    applyTheme();
    // Everything that matters except the clock and the now-line, so the
    // server can skip pushing a new TV image when nothing changed
    var parts = ['date', 'weather', 'today', 'tomorrow', 'legend', 'status', 'view-' + view];
    var sig = [];
    for (var p = 0; p < parts.length; p++) sig.push($(parts[p]).innerHTML);
    window.__wallSignature = sig.join('|') + '|' + (data ? data.brightness : '') + '|' + currentTheme();
    showView(view);
    renderNowLine();
  }

  function load() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/wall/data', true);
    xhr.onload = function () {
      if (xhr.status === 200) {
        data = JSON.parse(xhr.responseText);
        if (STATIC && !pinnedView) view = data.staticView || 'week';
        renderAll();
        window.__wallReady = true;
      } else {
        $('status').textContent = 'Server error ' + xhr.status;
      }
    };
    xhr.onerror = function () {
      $('status').textContent = 'Cannot reach the calendar server';
      window.__wallReady = true;
    };
    xhr.send();
  }

  // Shift the whole page a few pixels now and then so nothing sits in one spot all day
  var shifts = [[0, 0], [3, 2], [-2, 3], [2, -3], [-3, -2]];
  var shiftIndex = 0;
  function shift() {
    shiftIndex = (shiftIndex + 1) % shifts.length;
    $('stage').style.transform = 'translate(' + shifts[shiftIndex][0] + 'px,' + shifts[shiftIndex][1] + 'px)';
  }

  if (STATIC) {
    // A still image: no ticking clock, so show when it was drawn instead
    document.body.className = 'static';
    var now = new Date();
    $('updated').textContent = 'Updated ' + (now.getHours() % 12 || 12) + ':' + pad(now.getMinutes()) +
      (now.getHours() < 12 ? ' AM' : ' PM');
    load();
    return;
  }

  var lastDay = new Date().getDate();
  setInterval(function () {
    renderClock();
    // Redraw at midnight so "today" moves
    if (new Date().getDate() !== lastDay) { lastDay = new Date().getDate(); renderAll(); }
  }, 10 * 1000);
  setInterval(function () {
    renderAgenda('today', startOfToday(), true); // keeps "soon" / "past" current
    renderNowLine();
    applyTheme();
  }, 60 * 1000);

  function rotate() {
    if (!pinnedView) {
      rotations++;
      showView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]);
    }
    var seconds = (data && data.rotateSeconds) || 60;
    setTimeout(rotate, seconds * 1000);
  }
  setTimeout(rotate, 60 * 1000);
  setInterval(load, DATA_EVERY_MS);
  setInterval(shift, 10 * 60 * 1000);
  setTimeout(function () { location.reload(); }, RELOAD_EVERY_MS);

  renderAll();
  load();
})();
