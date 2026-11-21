const { createHash, timingSafeEqual } = require('node:crypto');
const { EventEmitter } = require('node:events');
const prisma = require('../lib/prisma');
const {
  ONLINE_MS, PlaybackError, emptySession, hasLiveLease, leaseDeadline, boundedPosition,
  projectedPosition, presentSession, optionalPosition, validatePlaybackCommand, validateDeviceId,
  validatePositionReport, shuffledOrder, navigationCandidates,
} = require('./playbackState');

const MAX_DEVICES = 20;
const DEVICE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const platforms = new Set(['browser', 'telegram']);
const events = new EventEmitter();

function subscribe(userId, listener) {
  const key = String(userId);
  events.on(key, listener);
  return () => events.off(key, listener);
}

function publish(userId) {
  events.emit(String(userId));
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

async function getSnapshot(userId) {
  const [session, devices] = await Promise.all([
    prisma.playbackSession.findUnique({ where: { userId } }),
    prisma.playbackDevice.findMany({
      where: { userId },
      select: { id: true, name: true, platform: true, lastSeenAt: true },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }],
      take: MAX_DEVICES,
    }),
  ]);
  const now = await databaseTime();
  return {
    serverTime: now.getTime(),
    session: presentSession(session ?? emptySession, now),
    devices: devices.map(device => ({
      ...device,
      lastSeenAt: device.lastSeenAt.getTime(),
      online: isOnline(device, now),
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

    const session = await tx.playbackSession.upsert({ where: { userId }, create: { userId }, update: {} });
    const protectedIds = [session.activeDeviceId, session.pendingDeviceId].filter(Boolean);
    const eligible = { userId, id: { notIn: protectedIds } };
    await tx.playbackDevice.deleteMany({
      where: { ...eligible, lastSeenAt: { lt: new Date(now.getTime() - DEVICE_RETENTION_MS) } },
    });
    if (await tx.playbackDevice.count({ where: { userId } }) >= MAX_DEVICES) {
      const offline = { ...eligible, lastSeenAt: { lt: new Date(now.getTime() - ONLINE_MS) } };
      const oldest = await tx.playbackDevice.findFirst({ where: offline, orderBy: { lastSeenAt: 'asc' } });
      if (!oldest) throw new PlaybackError(409, 'Too many playback devices are online');
      const removed = await tx.playbackDevice.deleteMany({ where: { ...offline, id: oldest.id } });
      if (!removed.count) throw new PlaybackError(409, 'Device roster changed');
    }
    await tx.playbackDevice.create({ data: { ...data, ...credentials, userId } });
  });
  publish(userId);
  return getSnapshot(userId);
}

async function verifyDevice(userId, body, touch = false) {
  const credentials = deviceCredentials(body);
  const device = await prisma.playbackDevice.findUnique({ where: deviceWhere(userId, credentials.id) });
  if (!matchesDevice(device, credentials)) throw new PlaybackError(403, 'Unknown playback device');
  if (touch) {
    const now = await databaseTime();
    if (now > device.lastSeenAt) {
      const touched = await prisma.playbackDevice.updateMany({
        where: { userId, id: device.id, keyHash: credentials.keyHash, lastSeenAt: { lt: now } },
        data: { lastSeenAt: now },
      });
      if (!touched.count) {
        const current = await prisma.playbackDevice.findUnique({ where: deviceWhere(userId, credentials.id) });
        if (!matchesDevice(current, credentials)) throw new PlaybackError(403, 'Unknown playback device');
      }
    }
  }
  return device.id;
}

async function mutateSession(userId, version, transition) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const session = await prisma.playbackSession.findUnique({ where: { userId } });
    if (!session) throw new PlaybackError(403, 'No registered playback session');
    if (version !== undefined && session.version !== version) {
      throw new PlaybackError(409, 'Playback session changed');
    }
    const now = await databaseTime();
    const mutation = await transition(session, now);
    if (!mutation) return;
    const { changes, extendOnly } = mutation;
    const result = await prisma.playbackSession.updateMany({
      // Heartbeats leave version stable. The lease belongs in the CAS so a handoff
      // cannot shorten an already-issued permit for the outgoing audio device.
      where: {
        userId, version: session.version, leaseUntil: session.leaseUntil,
        position: session.position, positionAt: session.positionAt,
      },
      data: extendOnly ? changes : { ...changes, version: { increment: 1 } },
    });
    if (result.count) {
      publish(userId);
      return;
    }
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
      const changes = { leaseUntil: leaseDeadline(now) };
      if (session.playing && report?.version === session.version && report.trackId === session.trackId) {
        changes.position = boundedPosition(report.position, session.duration);
        changes.positionAt = now;
      }
      return { changes, extendOnly: true };
    }
    return null;
  });
  return getSnapshot(userId);
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
  return getSnapshot(userId);
}

async function catalogTracks(ids) {
  if (!ids.length) return new Map();
  const tracks = await prisma.track.findMany({
    where: { id: { in: ids } },
    select: { id: true, duration: true },
  });
  return new Map(tracks.map(track => [track.id, track]));
}

async function playChanges(session, now, deviceId, command) {
  let queue = command.queue ?? session.queue;
  const trackId = command.trackId ?? (command.queue ? queue[0] : session.trackId);
  if (!trackId) throw new PlaybackError(409, 'Select a track first');
  if (!queue.includes(trackId)) queue = [trackId];
  const tracks = await catalogTracks(queue);
  if (!tracks.has(trackId)) throw new PlaybackError(404, 'Track no longer exists');
  queue = queue.filter(id => tracks.has(id));
  const index = queue.indexOf(trackId);
  const duration = tracks.get(trackId).duration;
  const sameTrack = session.trackId === trackId;
  const unchangedQueue = queue.length === session.queue.length && queue.every((id, i) => id === session.queue[i]);
  const position = command.position ?? (sameTrack ? projectedPosition(session, now) : 0);
  const playingFrom = duration !== null && position >= duration ? 0 : position;
  return {
    activeDeviceId: deviceId,
    pendingDeviceId: null,
    handoffResume: false,
    leaseUntil: leaseDeadline(now),
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

async function navigationChanges(session, now, deviceId, command) {
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
  const tracks = await catalogTracks(candidates.map(index => session.queue[index]));
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

async function commandChanges(userId, session, now, deviceId, command) {
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
      return playChanges(session, now, deviceId, command);
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
      return navigationChanges(session, now, deviceId, command);
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
  await mutateSession(userId, version, async (session, now) => {
    const changes = await commandChanges(userId, session, now, deviceId, command);
    return changes ? { changes } : null;
  });
  return getSnapshot(userId);
}

module.exports = { getSnapshot, registerDevice, heartbeat, acknowledge, applyCommand, subscribe, PlaybackError };
