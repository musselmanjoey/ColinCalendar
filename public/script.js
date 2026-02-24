let currentDate = new Date();
let events = [];

const monthTitle = document.getElementById('month-title');
const calendarGrid = document.getElementById('calendar');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');

prevBtn.addEventListener('click', () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  loadMonth();
});

nextBtn.addEventListener('click', () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  loadMonth();
});

function getMonthKey() {
  const y = currentDate.getFullYear();
  const m = String(currentDate.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function formatDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function fetchEvents() {
  const res = await fetch(`/api/events?month=${getMonthKey()}`);
  const data = await res.json();
  events = data.events || [];
}

async function addEvent(date) {
  const title = prompt('Event title:');
  if (!title || !title.trim()) return;
  await fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, title: title.trim() }),
  });
  await loadMonth();
}

async function deleteEvent(id, e) {
  e.stopPropagation();
  await fetch(`/api/events/${id}?month=${getMonthKey()}`, { method: 'DELETE' });
  await loadMonth();
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  monthTitle.textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const today = new Date();
  const todayStr = formatDate(today.getFullYear(), today.getMonth(), today.getDate());

  calendarGrid.innerHTML = '';

  // Empty cells before first day of month
  for (let i = 0; i < firstDay; i++) {
    const cell = document.createElement('div');
    cell.className = 'day-cell empty';
    calendarGrid.appendChild(cell);
  }

  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = formatDate(year, month, day);
    const cell = document.createElement('div');
    cell.className = 'day-cell';
    if (dateStr === todayStr) cell.classList.add('today');
    cell.addEventListener('click', () => addEvent(dateStr));

    const dayNum = document.createElement('div');
    dayNum.className = 'day-number';
    dayNum.textContent = day;
    cell.appendChild(dayNum);

    const dayEvents = events.filter(ev => ev.date === dateStr);
    dayEvents.forEach(ev => {
      const evEl = document.createElement('div');
      evEl.className = 'event';

      const titleSpan = document.createElement('span');
      titleSpan.textContent = ev.title;
      evEl.appendChild(titleSpan);

      const delBtn = document.createElement('button');
      delBtn.className = 'delete-btn';
      delBtn.textContent = '\u00d7';
      delBtn.addEventListener('click', (e) => deleteEvent(ev.id, e));
      evEl.appendChild(delBtn);

      cell.appendChild(evEl);
    });

    calendarGrid.appendChild(cell);
  }
}

async function loadMonth() {
  await fetchEvents();
  renderCalendar();
}

loadMonth();
