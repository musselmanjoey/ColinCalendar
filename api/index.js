const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// --- Storage ---
// Uses Upstash Redis in production (env vars injected by Vercel)
// Falls back to in-memory store for local dev

let redis;
const memoryStore = {};

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL) {
    if (!redis) {
      const { Redis } = require('@upstash/redis');
      redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
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

// Local dev: serve static files and start server
if (require.main === module) {
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.listen(3000, () => console.log('Running at http://localhost:3000'));
}

module.exports = app;
