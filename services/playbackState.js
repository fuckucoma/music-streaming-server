const { positiveInt } = require('../lib/validation');

const LEASE_MS = 12_000;
const ONLINE_MS = 30_000;
const MAX_QUEUE = 300;
const MAX_POSITION = 7 * 24 * 60 * 60;
const repeatOptions = new Set(['none', 'all', 'one']);

class PlaybackError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const emptySession = {
  version: 0, activeDeviceId: null, pendingDeviceId: null, leaseUntil: null,
  handoffResume: false, trackId: null, duration: null, queue: [], queueIndex: -1,
  shuffleOrder: [], playing: false, position: 0, positionAt: new Date(0), shuffle: false,
  repeat: 'none',
};

function hasLiveLease(session, now) {
  return Boolean(session.activeDeviceId && session.leaseUntil && session.leaseUntil > now);
}

function leaseDeadline(now) {
  return new Date(now.getTime() + LEASE_MS);
}

function boundedPosition(position, duration) {
  return Math.min(Math.max(position, 0), duration ?? MAX_POSITION);
}

function projectedPosition(session, now) {
  if (!session.trackId) return 0;
  const limit = session.leaseUntil ? Math.min(now.getTime(), session.leaseUntil.getTime()) : 0;
  const elapsed = session.playing ? Math.max(0, limit - session.positionAt.getTime()) / 1000 : 0;
  return boundedPosition(session.position + elapsed, session.duration);
}

function presentSession(session, now) {
  return {
    version: session.version,
    activeDeviceId: session.activeDeviceId,
    pendingDeviceId: session.pendingDeviceId,
    leaseUntil: session.leaseUntil?.getTime() ?? null,
    trackId: session.trackId,
    duration: session.duration,
    queue: session.queue,
    queueIndex: session.queueIndex,
    playing: !session.pendingDeviceId && hasLiveLease(session, now) && session.playing,
    position: projectedPosition(session, now),
    positionAt: session.positionAt.getTime(),
    shuffle: session.shuffle,
    repeat: session.repeat,
  };
}

function optionalPosition(position) {
  if (position === undefined) return undefined;
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > MAX_POSITION) {
    throw new PlaybackError(400, 'Invalid playback position');
  }
  return position;
}

function validateTrackId(value) {
  const id = positiveInt(value);
  if (!id) throw new PlaybackError(400, 'Invalid track ID');
  return id;
}

function validatePositionReport(report) {
  if (report === undefined) return null;
  if (!report || !Number.isInteger(report.version) || report.version < 0 || report.version > 2147483647) {
    throw new PlaybackError(400, 'Invalid position report');
  }
  const position = optionalPosition(report.position);
  if (position === undefined) throw new PlaybackError(400, 'Playback position required');
  return { trackId: validateTrackId(report.trackId), version: report.version, position };
}

function validatePlaybackCommand(command) {
  if (!command || typeof command !== 'object') throw new PlaybackError(400, 'Invalid playback command');
  const { type } = command;
  switch (type) {
    case 'play': {
      const trackId = command.trackId === undefined ? undefined : validateTrackId(command.trackId);
      let queue;
      if (command.queue !== undefined) {
        if (!Array.isArray(command.queue) || !command.queue.length || command.queue.length > MAX_QUEUE) {
          throw new PlaybackError(400, 'Invalid queue size');
        }
        queue = [...new Set(command.queue.map(validateTrackId))];
        if (trackId && !queue.includes(trackId)) throw new PlaybackError(400, 'Track is not in the queue');
      }
      return { type, trackId, queue, position: optionalPosition(command.position) };
    }
    case 'pause':
    case 'release':
      return { type, position: optionalPosition(command.position) };
    case 'seek': {
      const position = optionalPosition(command.position);
      if (position === undefined) throw new PlaybackError(400, 'Playback position required');
      return { type, position };
    }
    case 'next':
    case 'previous':
      return { type };
    case 'ended':
      return { type, trackId: command.trackId === undefined ? undefined : validateTrackId(command.trackId) };
    case 'setShuffle':
      if (typeof command.shuffle !== 'boolean') throw new PlaybackError(400, 'Invalid shuffle setting');
      return { type, shuffle: command.shuffle };
    case 'setRepeat':
      if (!repeatOptions.has(command.repeat)) throw new PlaybackError(400, 'Invalid repeat setting');
      return { type, repeat: command.repeat };
    case 'transfer':
      return { type, targetDeviceId: validateDeviceId(command.targetDeviceId) };
    default:
      throw new PlaybackError(400, 'Unknown playback command');
  }
}

function validateDeviceId(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)) {
    throw new PlaybackError(400, 'Invalid device ID');
  }
  return value.toLowerCase();
}

function shuffledOrder(queue, first) {
  if (!queue.length) return [];
  const remaining = queue.map((trackId, index) => index).filter(index => index !== first);
  for (let end = remaining.length - 1; end > 0; end--) {
    const swap = Math.floor(Math.random() * (end + 1));
    [remaining[end], remaining[swap]] = [remaining[swap], remaining[end]];
  }
  return first < 0 ? remaining : [first, ...remaining];
}

function navigationCandidates(session, direction, fromEnded) {
  const order = session.shuffle && session.shuffleOrder.length === session.queue.length
    ? session.shuffleOrder : session.queue.map((trackId, index) => index);
  const position = order.indexOf(session.queueIndex);
  if (direction === 'previous') return order.slice(0, Math.max(position, 0)).reverse().concat(order.slice(0, 1));
  const following = order.slice(position + 1);
  if (fromEnded && session.repeat !== 'all') return following;
  return following.concat(order.slice(0, position + 1));
}

module.exports = {
  LEASE_MS, ONLINE_MS, PlaybackError, emptySession, hasLiveLease, leaseDeadline, boundedPosition,
  projectedPosition, presentSession, optionalPosition, validatePlaybackCommand, validateDeviceId,
  validatePositionReport, shuffledOrder, navigationCandidates,
};
