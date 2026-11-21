const { createHash, timingSafeEqual } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const {
  ONLINE_MS, PlaybackError, emptySession, hasLiveLease, leaseDeadline, boundedPosition,
  projectedPosition, presentSession, optionalPosition, validatePlaybackCommand, validateDeviceId,
  validatePositionReport, shuffledOrder, navigationCandidates,
} = require('./playbackState');

const MAX_DEVICES = 20;
const DEVICE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PRESENCE_WRITE_INTERVAL = 10_000;
const WRITE_TRANSACTION_OPTIONS = { timeout: 10_000 };
const platforms = new Set(['browser', 'telegram']);
const events = new EventEmitter();

function subscribe(userId, listener) {
  const key = String(userId);
  events.on(key, listener);
  return () => events.off(key, listener);
}

function publishPlaybackChange(userId, snapshot) {
  events.emit(String(userId), snapshot);
}

async function changedSnapshot(userId) {
  try {
    const snapshot = await getSnapshot(userId);
    publishPlaybackChange(userId, snapshot);
    return snapshot;
  } catch (error) {
    publishPlaybackChange(userId);
    throw error;
  }
}

async function databaseTime(connection = prisma) {
  const [row] = await connection.$queryRaw`SELECT clock_timestamp() AS "now"`;
  return row.now;
}

function deviceWhere(userId, id) {
  return { userId_id: { userId, id } };
}

function deviceCredentials(body) {
  const id = validateDeviceId(body?.deviceId);
  const { deviceKey } = body;
  if (typeof deviceKey !== 'string' || !/^[a-z\d_-]{32,128}$/i.test(deviceKey)) {
    throw new PlaybackError(400, 'Invalid device key');
  }
  const keyHash = createHash('sha256').update(deviceKey).digest('hex');
  return { id, keyHash };
}

function matchesDevice(device, credentials) {
  return Boolean(device && device.keyHash.length === credentials.keyHash.length &&
    timingSafeEqual(Buffer.from(device.keyHash), Buffer.from(credentials.keyHash)));
}

function expectedVersion(body) {
  const version = body?.expectedVersion;
  if (!Number.isInteger(version) || version < 0 || version > 2147483647) {
    throw new PlaybackError(400, 'Invalid session version');
  }
  return version;
}

function isOnline(device, now) {
  return Boolean(device && now.getTime() - device.lastSeenAt.getTime() < ONLINE_MS);
}

async function lockSession(db, userId) {
  const [session] = await db.$queryRaw`
    SELECT * FROM "PlaybackSession" WHERE "userId" = ${userId} FOR UPDATE`;
  return session;
}

async function getSnapshot(userId) {
  // Read both parts of the response in one round trip and one PostgreSQL snapshot.
  const [{ now, devices, ...session }] = await prisma.$queryRaw`
    SELECT clock_timestamp() AS "now", session.*, COALESCE((
      SELECT json_agg(device ORDER BY device."lastSeenAt" DESC, device.id)
      FROM (
        SELECT id, name, platform, (EXTRACT(EPOCH FROM "lastSeenAt") * 1000)::bigint AS "lastSeenAt"
        FROM "PlaybackDevice"
        WHERE "userId" = ${userId}
        ORDER BY "lastSeenAt" DESC, id
        LIMIT ${MAX_DEVICES}
      ) device
    ), '[]'::json) AS devices
    FROM (VALUES (${userId}::integer)) AS owner(id)
    LEFT JOIN "PlaybackSession" session ON session."userId" = owner.id`;
  const serverTime = now.getTime();
  return {
    serverTime,
    session: presentSession(session.userId === null ? emptySession : session, now),
    devices: devices.map(device => ({
      ...device,
      online: serverTime - device.lastSeenAt < ONLINE_MS,
    })),
  };
}

async function registerDevice(userId, body) {
  const credentials = deviceCredentials(body);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) {
    throw new PlaybackError(400, 'Invalid device name');
  }
  if (!platforms.has(body.platform)) throw new PlaybackError(400, 'Invalid device platform');

  await prisma.$transaction(async tx => {
    // Serialize registration and eviction for this owner to enforce the roster cap.
    const owners = await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    if (!owners.length) throw new PlaybackError(401, 'Account no longer exists');
    const now = await databaseTime(tx);
    const where = deviceWhere(userId, credentials.id);
    const device = await tx.playbackDevice.findUnique({ where });
    const data = { name, platform: body.platform, lastSeenAt: now };
    if (device) {
      if (!matchesDevice(device, credentials)) throw new PlaybackError(403, 'Device credentials do not match');
      await tx.playbackDevice.update({ where, data });
      return;
    }

    const session = await lockSession(tx, userId) ?? await tx.playbackSession.create({ data: { userId } });
    const protectedIds = [session.activeDeviceId, session.pendingDeviceId].filter(Boolean);
    const eligible = { userId, id: { notIn: protectedIds } };
    const pruned = await tx.playbackDevice.deleteMany({
      where: { ...eligible, lastSeenAt: { lt: new Date(now.getTime() - DEVICE_RETENTION_MS) } },
    });
    let evicted = false;
    if (await tx.playbackDevice.count({ where: { userId } }) >= MAX_DEVICES) {
      const offline = { ...eligible, lastSeenAt: { lt: new Date(now.getTime() - ONLINE_MS) } };
      const oldest = await tx.playbackDevice.findFirst({ where: offline, orderBy: { lastSeenAt: 'asc' } });
      if (!oldest) throw new PlaybackError(409, 'Too many playback devices are online');
      const removed = await tx.playbackDevice.deleteMany({ where: { ...offline, id: oldest.id } });
      if (!removed.count) throw new PlaybackError(409, 'Device roster changed');
      evicted = true;
    }
    if (pruned.count || evicted) {
      await tx.playbackSession.update({ where: { userId }, data: { version: { increment: 1 } } });
    }
    await tx.playbackDevice.create({ data: { ...data, ...credentials, userId } });
  }, WRITE_TRANSACTION_OPTIONS);
  return changedSnapshot(userId);
}

async function removeDevice(userId, targetDeviceId) {
  const id = validateDeviceId(targetDeviceId);
  await prisma.$transaction(async tx => {
    const session = await lockSession(tx, userId);
    const now = await databaseTime(tx);
    const device = await tx.playbackDevice.findUnique({ where: deviceWhere(userId, id) });
    if (!device) throw new PlaybackError(404, 'Playback device not found');
    if (isOnline(device, now)) throw new PlaybackError(409, 'Only offline devices can be removed');
    const wasActive = session?.activeDeviceId === id;
    const wasPending = session?.pendingDeviceId === id;
    if ((wasActive || wasPending) && hasLiveLease(session, now)) {
      throw new PlaybackError(409, 'Finish the active device handoff before removing this device');
    }

    const result = await tx.playbackDevice.deleteMany({
      where: { userId, id, lastSeenAt: { lte: new Date(now.getTime() - ONLINE_MS) } },
    });
    if (!result.count) throw new PlaybackError(409, 'Playback device came online');
    if (session) {
      const data = { version: { increment: 1 } };
      if (wasActive) Object.assign(data, {
        activeDeviceId: null, leaseUntil: null, position: projectedPosition(session, now),
        positionAt: now, playing: false,
      });
      if (wasPending) Object.assign(data, { pendingDeviceId: null, handoffResume: false });
      await tx.playbackSession.update({ where: { userId }, data });
    }
  });
  return changedSnapshot(userId);
}

async function verifyDevice(userId, body, touch = false) {
  const credentials = deviceCredentials(body);
  const where = deviceWhere(userId, credentials.id);
  const device = touch
    ? (await prisma.$queryRaw`
        SELECT "keyHash", "lastSeenAt", clock_timestamp() AS "now"
        FROM "PlaybackDevice" WHERE "userId" = ${userId} AND id = ${credentials.id}::uuid`)[0]
    : await prisma.playbackDevice.findUnique({ where });
  if (!matchesDevice(device, credentials)) throw new PlaybackError(403, 'Unknown playback device');
  if (touch) {
    const { now } = device;
    if (now.getTime() - device.lastSeenAt.getTime() >= PRESENCE_WRITE_INTERVAL) {
      const touched = await prisma.playbackDevice.updateMany({
        where: { userId, id: credentials.id, keyHash: credentials.keyHash, lastSeenAt: { lt: now } },
        data: { lastSeenAt: now },
      });
      if (!touched.count) {
        const current = await prisma.playbackDevice.findUnique({ where });
        if (!matchesDevice(current, credentials)) throw new PlaybackError(403, 'Unknown playback device');
      }
    }
  }
  return credentials.id;
}

async function mutateSession(userId, version, transition, lockTracks = false) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const update = async db => {
      const [session] = await db.$queryRaw`
        SELECT *, clock_timestamp() AS "now" FROM "PlaybackSession" WHERE "userId" = ${userId}`;
      if (!session) throw new PlaybackError(403, 'No registered playback session');
      if (version !== undefined && session.version !== version) {
        throw new PlaybackError(409, 'Playback session changed');
      }
      const mutation = await transition(session, session.now, db);
      if (!mutation) return true;
      const { changes, extendOnly } = mutation;
      const result = await db.playbackSession.updateMany({
        // Heartbeats can renew a permit without changing version.
        where: {
          userId, version: session.version, leaseUntil: session.leaseUntil,
          position: session.position, positionAt: session.positionAt,
        },
        data: extendOnly ? changes : { ...changes, version: { increment: 1 } },
      });
      return result.count === 1;
    };
    if (lockTracks ? await prisma.$transaction(update, WRITE_TRANSACTION_OPTIONS) : await update(prisma)) return;
  }
  throw new PlaybackError(409, 'Playback session changed');
}

function claim(session, now, deviceId) {
  if (hasLiveLease(session, now)) return {};
  return { activeDeviceId: deviceId, pendingDeviceId: null, handoffResume: false, leaseUntil: leaseDeadline(now) };
}

function finishHandoff(session, now, position) {
  return {
    activeDeviceId: session.pendingDeviceId,
    pendingDeviceId: null,
    leaseUntil: leaseDeadline(now),
    handoffResume: false,
    playing: session.handoffResume && Boolean(session.trackId),
    position: boundedPosition(position ?? projectedPosition(session, now), session.duration),
    positionAt: now,
  };
}

async function heartbeat(userId, body) {
  const deviceId = await verifyDevice(userId, body, true);
  const report = validatePositionReport(body.report);
  await mutateSession(userId, undefined, (session, now) => {
    const live = hasLiveLease(session, now);
    if (!live && session.pendingDeviceId === deviceId) {
      return { changes: finishHandoff(session, now) };
    }
    if (live && session.activeDeviceId === deviceId && !session.pendingDeviceId) {
      const deadline = leaseDeadline(now);
      const changes = { leaseUntil: deadline > session.leaseUntil ? deadline : session.leaseUntil };
      if (session.playing && now >= session.positionAt &&
          report?.version === session.version && report.trackId === session.trackId) {
        changes.position = boundedPosition(report.position, session.duration);
        changes.positionAt = now;
      }
      return { changes, extendOnly: true };
    }
    return null;
  });
  return changedSnapshot(userId);
}

async function acknowledge(userId, body) {
  const deviceId = await verifyDevice(userId, body);
  const version = expectedVersion(body);
  const position = optionalPosition(body.position);
  await mutateSession(userId, version, (session, now) => {
    if (session.activeDeviceId !== deviceId) throw new PlaybackError(403, 'Only the outgoing device may acknowledge');
    if (!session.pendingDeviceId) throw new PlaybackError(409, 'No pending handoff');
    return { changes: finishHandoff(session, now, position) };
  });
  return changedSnapshot(userId);
}

async function catalogTracks(db, ids) {
  if (!ids.length) return new Map();
  // Track deletion locks the same rows before touching playback sessions.
  const tracks = await db.$queryRaw(Prisma.sql`
    SELECT "id", "duration"
    FROM "Track"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR KEY SHARE
  `);
  return new Map(tracks.map(track => [track.id, track]));
}

async function playChanges(db, session, now, deviceId, command) {
  let queue = command.queue ?? session.queue;
  const trackId = command.trackId ?? (command.queue ? queue[0] : session.trackId);
  if (!trackId) throw new PlaybackError(409, 'Select a track first');
  if (!queue.includes(trackId)) queue = [trackId];
  const tracks = await catalogTracks(db, queue);
  if (!tracks.has(trackId)) throw new PlaybackError(404, 'Track no longer exists');
  queue = queue.filter(id => tracks.has(id));
  const index = queue.indexOf(trackId);
  const duration = tracks.get(trackId).duration;
  const sameTrack = session.trackId === trackId;
  const unchangedQueue = queue.length === session.queue.length && queue.every((id, i) => id === session.queue[i]);
  const position = command.position ?? (sameTrack ? projectedPosition(session, now) : 0);
  const playingFrom = duration !== null && position >= duration ? 0 : position;
  return {
    ...claim(session, now, deviceId),
    trackId,
    duration,
    queue,
    queueIndex: index,
    shuffleOrder: session.shuffle && !(sameTrack && unchangedQueue)
      ? shuffledOrder(queue, index)
      : session.shuffleOrder,
    playing: true,
    position: boundedPosition(playingFrom, duration),
    positionAt: now,
  };
}

async function navigationChanges(db, session, now, deviceId, command) {
  const fromEnded = command.type === 'ended';
  const position = projectedPosition(session, now);
  const live = hasLiveLease(session, now);
  if (fromEnded && (session.activeDeviceId !== deviceId || !live)) {
    throw new PlaybackError(403, 'Only the active device may finish a track');
  }
  if (fromEnded && command.trackId !== undefined && command.trackId !== session.trackId) {
    throw new PlaybackError(409, 'Track already changed');
  }
  if (!session.trackId || (fromEnded && !session.playing)) return null;
  if (fromEnded && session.repeat === 'one') return { playing: true, position: 0, positionAt: now };
  if (command.type === 'previous' && position > 3) {
    return { playing: live && session.playing, position: 0, positionAt: now };
  }

  const candidates = navigationCandidates(session, command.type, fromEnded);
  const tracks = await catalogTracks(db, candidates.map(index => session.queue[index]));
  const index = candidates.find(candidate => tracks.has(session.queue[candidate]));
  if (index === undefined) {
    return { playing: false, position: fromEnded ? session.duration ?? position : position, positionAt: now };
  }
  const trackId = session.queue[index];
  return {
    ...claim(session, now, deviceId), trackId, duration: tracks.get(trackId).duration,
    queueIndex: index, playing: true, position: 0, positionAt: now,
  };
}

async function transferChanges(userId, session, now, targetDeviceId) {
  const live = hasLiveLease(session, now);
  if (live && targetDeviceId === session.pendingDeviceId) return null;
  if (live && session.pendingDeviceId) throw new PlaybackError(409, 'Handoff is already pending');
  if (live && targetDeviceId === session.activeDeviceId) return null;

  const target = await prisma.playbackDevice.findUnique({ where: deviceWhere(userId, targetDeviceId) });
  if (!target) throw new PlaybackError(403, 'Unknown handoff target');
  if (!isOnline(target, now)) throw new PlaybackError(409, 'Handoff device is offline');
  if (live) return { pendingDeviceId: targetDeviceId, handoffResume: session.playing };

  return finishHandoff({
    ...session,
    pendingDeviceId: targetDeviceId,
    handoffResume: session.pendingDeviceId ? session.handoffResume : false,
  }, now);
}

async function commandChanges(db, userId, session, now, deviceId, command) {
  if (command.type === 'transfer') return transferChanges(userId, session, now, command.targetDeviceId);

  const live = hasLiveLease(session, now);
  if (session.pendingDeviceId && (live || command.type !== 'play')) {
    throw new PlaybackError(409, 'Handoff is pending');
  }
  if (session.pendingDeviceId && deviceId !== session.pendingDeviceId) {
    const target = await prisma.playbackDevice.findUnique({ where: deviceWhere(userId, session.pendingDeviceId) });
    if (isOnline(target, now)) throw new PlaybackError(409, 'Handoff is pending');
  }

  switch (command.type) {
    case 'play':
      return playChanges(db, session, now, deviceId, command);
    case 'pause':
    case 'release': {
      if (command.type === 'release' && session.activeDeviceId !== deviceId) {
        throw new PlaybackError(403, 'Only the active device may release playback');
      }
      const reported = session.activeDeviceId === deviceId ? command.position : undefined;
      const position = boundedPosition(reported ?? projectedPosition(session, now), session.duration);
      const released = command.type === 'release' ? { activeDeviceId: null, leaseUntil: null } : {};
      return { ...released, playing: false, position, positionAt: now };
    }
    case 'seek':
      if (!session.trackId) throw new PlaybackError(409, 'Select a track first');
      return { playing: live && session.playing, position: boundedPosition(command.position, session.duration), positionAt: now };
    case 'next':
    case 'previous':
    case 'ended':
      return navigationChanges(db, session, now, deviceId, command);
    case 'setShuffle':
      if (session.shuffle === command.shuffle) return null;
      return { shuffle: command.shuffle, shuffleOrder: command.shuffle ? shuffledOrder(session.queue, session.queueIndex) : [] };
    case 'setRepeat':
      return session.repeat === command.repeat ? null : { repeat: command.repeat };
  }
}

async function applyCommand(userId, body) {
  const deviceId = await verifyDevice(userId, body, true);
  const version = expectedVersion(body);
  const command = validatePlaybackCommand(body.command);
  const lockTracks = ['play', 'next', 'previous', 'ended'].includes(command.type);
  await mutateSession(userId, version, async (session, now, db) => {
    const changes = await commandChanges(db, userId, session, now, deviceId, command);
    return changes ? { changes } : null;
  }, lockTracks);
  return changedSnapshot(userId);
}

module.exports = {
  getSnapshot, registerDevice, removeDevice, heartbeat, acknowledge, applyCommand, subscribe,
  publishPlaybackChange, PlaybackError,
};
