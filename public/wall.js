/* TV wall calendar. Written in ES5 on purpose: Samsung TV browsers can be old
 * Chromium builds, so no arrow functions, async/await, padStart, etc. */
(function () {
  'use strict';

  var DATA_EVERY_MS = 5 * 60 * 1000;
  var RELOAD_EVERY_MS = 6 * 60 * 60 * 1000; // picks up page changes
  var MAX_LINES = 5;
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var WEATHER = {
    0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog',
    51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow', 80: 'Showers', 81: 'Showers',
    82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Storms', 96: 'Storms', 99: 'Storms'
  };

  var data = null;

  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDay(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var c = new Date(d.getTime()); c.setDate(c.getDate() + n); return c; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function shortTime(d) {
    var h = d.getHours(), m = d.getMinutes();
    var s = (h % 12 || 12) + (m ? ':' + pad(m) : '');
    return s + (h < 12 ? 'a' : 'p');
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

  function renderClock() {
    var now = new Date();
    var h = now.getHours();
    $('clock').innerHTML = (h % 12 || 12) + ':' + pad(now.getMinutes()) +
      '<span class="ampm">' + (h < 12 ? 'AM' : 'PM') + '</span>';
    $('date').textContent = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()] +
      ', ' + MONTHS[now.getMonth()] + ' ' + now.getDate();
  }

  function renderWeather() {
    var w = data && data.weather;
    if (!w) { $('weather').innerHTML = ''; return; }
    var html = '<div class="now">' + w.temp + '&deg;<small>' + esc(WEATHER[w.code] || '') + '</small></div><div class="days">';
    for (var i = 0; i < w.days.length; i++) {
      var d = w.days[i];
      html += '<div class="day"><b>' + (i === 0 ? 'Today' : DAYS[parseDay(d.date).getDay()]) + '</b>' +
        '<span class="hi">' + d.hi + '&deg;</span> ' + d.lo + '&deg;' +
        (d.rain >= 30 ? '<br>' + d.rain + '% rain' : '<br>&nbsp;') + '</div>';
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

  function renderMonth() {
    var today = new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var first = new Date(today.getFullYear(), today.getMonth(), 1);
    var start = addDays(first, -first.getDay());
    var weeks = Math.ceil((first.getDay() + new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()) / 7);

    $('month-title').textContent = MONTHS[today.getMonth()] + ' ' + today.getFullYear();
    var head = '';
    for (var d = 0; d < 7; d++) head += '<div>' + DAYS[d] + '</div>';
    $('weekdays').innerHTML = head;

    var html = '';
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
    $('grid').innerHTML = html;
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

  function renderAll() {
    renderClock();
    renderWeather();
    var today = new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    renderAgenda('today', today, true);
    renderAgenda('tomorrow', addDays(today, 1), false);
    renderMonth();
    renderLegend();
    if (data) document.body.style.filter = 'brightness(' + data.brightness + ')';
  }

  function load() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/wall/data', true);
    xhr.onload = function () {
      if (xhr.status === 200) {
        data = JSON.parse(xhr.responseText);
        renderAll();
      } else {
        $('status').textContent = 'Server error ' + xhr.status;
      }
    };
    xhr.onerror = function () { $('status').textContent = 'Cannot reach the calendar server'; };
    xhr.send();
  }

  // Shift the whole page a few pixels now and then so nothing sits in one spot all day
  var shifts = [[0, 0], [3, 2], [-2, 3], [2, -3], [-3, -2]];
  var shiftIndex = 0;
  function shift() {
    shiftIndex = (shiftIndex + 1) % shifts.length;
    $('stage').style.transform = 'translate(' + shifts[shiftIndex][0] + 'px,' + shifts[shiftIndex][1] + 'px)';
  }

  var lastDay = new Date().getDate();
  setInterval(function () {
    renderClock();
    // Redraw at midnight so "today" moves
    if (new Date().getDate() !== lastDay) { lastDay = new Date().getDate(); renderAll(); }
  }, 10 * 1000);
  setInterval(function () {
    var today = new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    renderAgenda('today', today, true); // keeps "soon" / "past" current
  }, 60 * 1000);
  setInterval(load, DATA_EVERY_MS);
  setInterval(shift, 10 * 60 * 1000);
  setTimeout(function () { location.reload(); }, RELOAD_EVERY_MS);

  renderAll();
  load();
})();
