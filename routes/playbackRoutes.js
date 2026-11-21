const express = require('express');
const { authenticateToken, readAuthenticatedUser } = require('../middlewares/auth');
const {
  getSnapshot, registerDevice, heartbeat, acknowledge, applyCommand, subscribe, PlaybackError,
} = require('../services/playback');

const router = express.Router();
const owners = new Map();
const MAX_STREAMS = 64;
const MAX_OWNER_STREAMS = 8;
const REFRESH_INTERVAL = 2_500;
const KEEPALIVE_INTERVAL = 12_000;
const STREAM_DURATION = 60_000;
let openStreams = 0;

router.use(authenticateToken, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function playbackEndpoint(handler) {
  return async (req, res, next) => {
    const { userId } = req.user;
    try {
      const snapshot = await handler(userId, req.body);
      res.json(snapshot);
    } catch (error) {
      if (!(error instanceof PlaybackError)) return next(error);
      if (error.status !== 409) return res.status(error.status).json({ error: error.message });
      try {
        const snapshot = await getSnapshot(userId);
        return res.status(409).json({ error: error.message, snapshot });
      } catch (readError) {
        return next(readError);
      }
    }
  };
}

function eventVersion(snapshot) {
  const { session, devices } = snapshot;
  return JSON.stringify([
    session.version, session.leaseUntil, session.playing, session.positionAt,
    devices.map(device => [device.id, device.name, device.platform, device.lastSeenAt, device.online]),
  ]);
}

router.get('/session', playbackEndpoint(getSnapshot));
router.post('/devices', playbackEndpoint(registerDevice));
router.post('/heartbeat', playbackEndpoint(heartbeat));
router.post('/ack', playbackEndpoint(acknowledge));
router.post('/command', playbackEndpoint(applyCommand));

router.get('/events', (req, res) => {
  const { userId } = req.user;
  const count = owners.get(userId) ?? 0;
  if (openStreams >= MAX_STREAMS || count >= MAX_OWNER_STREAMS) {
    return res.set('Retry-After', '5').status(429).json({ error: 'Too many open playback streams' });
  }
  owners.set(userId, count + 1);
  openStreams++;
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  let closed = false;
  let refreshing = false;
  let needsRefresh = false;
  let lastEvent;

  function finish() {
    if (closed) return;
    closed = true;
    clearInterval(refreshTimer);
    clearInterval(keepaliveTimer);
    clearTimeout(expiryTimer);
    unsubscribe();
    openStreams--;
    const remaining = owners.get(userId) - 1;
    if (remaining) owners.set(userId, remaining);
    else owners.delete(userId);
    if (!res.destroyed && !res.writableEnded) res.end();
  }

  function send(value) {
    if (closed) return;
    if (res.destroyed || !res.write(value)) finish();
  }

  async function refresh() {
    if (closed) return;
    if (refreshing) {
      needsRefresh = true;
      return;
    }
    refreshing = true;
    try {
      do {
        needsRefresh = false;
        const snapshot = await getSnapshot(userId);
        if (closed) return;
        const version = eventVersion(snapshot);
        if (version !== lastEvent) {
          const auth = await readAuthenticatedUser(req.headers.authorization);
          if (closed) return;
          if (auth?.userId !== userId) return finish();
          lastEvent = version;
          send(`event: session\ndata: ${JSON.stringify(snapshot)}\n\n`);
        }
      } while (needsRefresh && !closed);
    } catch (error) {
      console.warn('Playback event stream refresh failed:', error.code || error.name);
      finish();
    } finally {
      refreshing = false;
    }
  }

  const unsubscribe = subscribe(userId, refresh);
  const refreshTimer = setInterval(refresh, REFRESH_INTERVAL);
  const keepaliveTimer = setInterval(() => send(': keepalive\n\n'), KEEPALIVE_INTERVAL);
  const expiryTimer = setTimeout(finish, STREAM_DURATION);
  res.once('close', finish);
  if (res.destroyed) return finish();
  res.flushHeaders();
  send('retry: 2000\n\n');
  void refresh();
});

module.exports = router;
