const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  LEASE_MS, PlaybackError, emptySession, hasLiveLease, leaseDeadline, presentSession,
  projectedPosition, navigationCandidates, shuffledOrder, validatePlaybackCommand, validatePositionReport,
} = require('../services/playbackState');

const start = new Date(1_800_000_000_000);
const at = milliseconds => new Date(start.getTime() + milliseconds);
const active = {
  ...emptySession,
  activeDeviceId: 'browser',
  leaseUntil: leaseDeadline(start),
  trackId: 12,
  duration: 90,
  queueIndex: 0,
  queue: [12, 13, 14],
  playing: true,
  position: 4.5,
  positionAt: start,
};

test('playback prediction stops advancing at the active lease deadline', () => {
  assert.equal(projectedPosition(active, at(3200)), 7.7);
  assert.equal(projectedPosition(active, at(LEASE_MS + 60_000)), active.position + LEASE_MS / 1_000);
  assert.equal(hasLiveLease(active, at(LEASE_MS - 1)), true);
  assert.equal(hasLiveLease(active, at(LEASE_MS)), false);
  assert.equal(presentSession(active, at(LEASE_MS)).playing, false);
  assert.equal(projectedPosition({ ...active, duration: 6 }, at(3200)), 6);
});

test('pending handoff suppresses playback for both devices before the lease fence', () => {
  const snapshot = presentSession({ ...active, pendingDeviceId: 'telegram' }, at(1000));
  assert.equal(snapshot.activeDeviceId, 'browser');
  assert.equal(snapshot.pendingDeviceId, 'telegram');
  assert.equal(snapshot.playing, false);
  assert.equal(snapshot.position, 5.5);
  assert.equal(snapshot.positionAt, start.getTime());
});

test('natural end respects saved shuffle order and repeats only in repeat-all mode', () => {
  const shuffled = { ...active, queueIndex: 1, shuffle: true, shuffleOrder: [0, 2, 1] };
  assert.deepEqual(navigationCandidates(shuffled, 'ended', true), []);
  assert.deepEqual(navigationCandidates({ ...shuffled, repeat: 'all' }, 'ended', true), [0, 2, 1]);
  assert.deepEqual(navigationCandidates(shuffled, 'next', false), [0, 2, 1]);
  assert.equal(navigationCandidates(shuffled, 'previous', false)[0], 2);
  assert.equal(presentSession({ ...shuffled, queueIndex: 0 }, start).endedTrackId, 14);
  assert.equal(presentSession(shuffled, start).endedTrackId, null);
  assert.equal(presentSession(shuffled, start).nextTrackId, 12);
  assert.equal(presentSession({ ...shuffled, repeat: 'all' }, start).endedTrackId, 12);
  assert.equal(presentSession({ ...shuffled, trackId: 13, repeat: 'one' }, start).endedTrackId, 13);
  const order = shuffledOrder(shuffled.queue, 1);
  assert.equal(order[0], 1);
  assert.deepEqual([...order].sort(), [0, 1, 2]);
});

test('commands and heartbeat reports reject invalid media and versions', () => {
  assert.deepEqual(validatePlaybackCommand({ type: 'play', trackId: 12, queue: [12, 12, 13] }).queue, [12, 13]);
  assert.throws(() => validatePlaybackCommand({ type: 'play', trackId: 12, queue: [13] }), PlaybackError);
  assert.throws(() => validatePlaybackCommand({ type: 'seek', position: -1 }), PlaybackError);
  assert.throws(() => validatePlaybackCommand({ type: 'seek', position: 12, seekId: 'invalid' }), PlaybackError);
  const seekId = '7cbadac1-fdcb-4167-a3f9-9a568fe254ba';
  assert.deepEqual(validatePlaybackCommand({ type: 'seek', position: 12, seekId: seekId.toUpperCase() }),
    { type: 'seek', position: 12, seekId });
  assert.throws(() => validatePositionReport({ version: 3, trackId: 12, position: Infinity }), PlaybackError);
  assert.throws(() => validatePositionReport({ version: -1, trackId: 12, position: 1 }), PlaybackError);
  assert.deepEqual(validatePositionReport({ version: 3, trackId: 12, position: 2 }), { version: 3, trackId: 12, position: 2 });
});
