require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { DateTime } = require('luxon');

const PORT = process.env.PORT || 4000;
const HOST_URL = process.env.HOST_URL || `http://localhost:${PORT}`;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || `${HOST_URL}/api/google/oauth2callback`;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const TIMEZONE = process.env.GOOGLE_TIMEZONE || 'America/Santiago';
const SLOT_DURATION_MINUTES = Number(process.env.SLOT_DURATION_MINUTES) || 45;
const SLOT_LOOKAHEAD_DAYS = Number(process.env.SLOT_LOOKAHEAD_DAYS) || 12;
const BUSINESS_SLOTS = (process.env.BUSINESS_SLOTS || '09:00,11:00,14:00,16:00')
  .split(',')
  .map((s) => s.trim());
const TOKEN_PATH =
  process.env.GOOGLE_TOKEN_PATH || path.join(__dirname, 'data', 'google-tokens.json');

if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error('Necesitás establecer GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.');
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const app = express();
app.use(cors());
app.use(express.json());

function ensureDataDir() {
  const dir = path.dirname(TOKEN_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function saveTokens(tokens) {
  ensureDataDir();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

function loadTokens() {
  if (!fs.existsSync(TOKEN_PATH)) {
    return null;
  }
  const raw = fs.readFileSync(TOKEN_PATH, 'utf8');
  return JSON.parse(raw);
}

function getOAuthClient() {
  const tokens = loadTokens();
  if (!tokens) {
    return null;
  }
  oauth2Client.setCredentials(tokens);
  oauth2Client.on('tokens', (freshTokens) => {
    saveTokens({ ...tokens, ...freshTokens });
  });
  return oauth2Client;
}

app.get('/api/google/status', (req, res) => {
  const authorized = Boolean(loadTokens());
  res.json({ authorized });
});

app.get('/api/google/auth-url', (req, res) => {
  const scopes = ['https://www.googleapis.com/auth/calendar'];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });
  res.json({ url });
});

app.get('/api/google/oauth2callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Falta el código de OAuth.');
  }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    saveTokens(tokens);
    res.send(
      'Autorización completa. Podés cerrar esta ventana y volver al sitio para terminar la reserva.'
    );
  } catch (error) {
    console.error(error);
    res.status(500).send('Hubo un error guardando las credenciales.');
  }
});

async function requireAuth(res) {
  const client = getOAuthClient();
  if (!client) {
    res.status(403).json({
      error:
        'No está conectado el calendario. Visitá `/api/google/auth-url`, autorizá la cuenta y volvé a cargar.',
    });
    return null;
  }
  return client;
}

function getNextAvailableDays(count) {
  const days = [];
  let cursor = DateTime.now().setZone(TIMEZONE).startOf('day');
  while (days.length < count) {
    if (cursor.weekday <= 5) {
      days.push(cursor);
    }
    cursor = cursor.plus({ days: 1 });
  }
  return days;
}

function isSlotBusy(slotStart, slotEnd, busyWindows) {
  return busyWindows.some(
    (window) => slotStart < window.end && slotEnd > window.start
  );
}

app.get('/api/google/availability', async (req, res) => {
  const client = await requireAuth(res);
  if (!client) return;

  const calendar = google.calendar({ version: 'v3', auth: client });
  const now = DateTime.now().setZone(TIMEZONE);
  const timeMin = now.startOf('day').toISO();
  const timeMax = now.plus({ days: SLOT_LOOKAHEAD_DAYS }).endOf('day').toISO();

  try {
    const freebusy = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        timeZone: TIMEZONE,
        items: [{ id: CALENDAR_ID }],
      },
    });

    const busyEntries =
      freebusy.data.calendars[CALENDAR_ID]?.busy || freebusy.data.calendars.primary?.busy || [];
    const busyWindows = busyEntries.map((entry) => ({
      start: DateTime.fromISO(entry.start).setZone(TIMEZONE),
      end: DateTime.fromISO(entry.end).setZone(TIMEZONE),
    }));

    const days = getNextAvailableDays(SLOT_LOOKAHEAD_DAYS).map((day) => {
      const slots = BUSINESS_SLOTS.map((slot) => {
        const [hour, minute = 0] = slot.split(':').map(Number);
        const slotStart = day.set({ hour, minute });
        const slotEnd = slotStart.plus({ minutes: SLOT_DURATION_MINUTES });
        if (slotStart < now) {
          return null;
        }
        if (isSlotBusy(slotStart, slotEnd, busyWindows)) {
          return null;
        }
        return {
          start: slotStart.toISO(),
          end: slotEnd.toISO(),
          timeLabel: slot,
          display: slotStart.toLocaleString('es-CL', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        };
      });
      return {
        date: day.toISODate(),
        label: day.toLocaleString('es-CL', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        }),
        slots: slots.filter(Boolean),
      };
    });

    res.json({
      timeZone: TIMEZONE,
      days: days.filter((day) => day.slots.length),
      meta: {
        durationMinutes: SLOT_DURATION_MINUTES,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo consultar la disponibilidad.' });
  }
});

app.post('/api/google/event', async (req, res) => {
  const client = await requireAuth(res);
  if (!client) return;

  const { start, end, name, email, notes } = req.body;
  if (!start || !end || !name || !email) {
    return res.status(400).json({ error: 'Faltan datos obligatorios en la reserva.' });
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth: client });
    const event = {
      summary: 'Reunión estratégica | Baumann & Co.',
      description: ['Agenda estratégica con Baumann & Co.', `Participante: ${name}`, notes]
        .filter(Boolean)
        .join('\n'),
      start: {
        dateTime: start,
        timeZone: TIMEZONE,
      },
      end: {
        dateTime: end,
        timeZone: TIMEZONE,
      },
      attendees: [
        {
          email,
          displayName: name,
        },
      ],
      reminders: {
        useDefault: true,
      },
    };

    const result = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: event,
      sendUpdates: 'all',
      conferenceDataVersion: 0,
    });

    res.json({
      success: true,
      htmlLink: result.data.htmlLink,
      message: 'La reserva se creó y se envió la invitación por correo.',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error:
        error?.message ||
        'Ocurrió un problema creando el evento. Verificá que el token tenga permisos.',
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Hubo un error inesperado.' });
});

app.listen(PORT, () => {
  console.log(`API de reservas escuchando en http://localhost:${PORT}`);
  console.log(`Redirige OAuth a ${REDIRECT_URI}`);
});
