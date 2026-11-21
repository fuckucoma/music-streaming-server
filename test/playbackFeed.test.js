const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

function snapshot(version, leaseUntil = 50_000, serverTime = 20_000) {
  return {
    serverTime,
    session: { version, leaseUntil, positionAt: 19_000, playing: true },
    devices: [{ id: 'tab', name: 'Browser', platform: 'browser', online: true, lastSeenAt: serverTime }],
  };
}

test('same-owner SSE streams reuse one read and coalesce local snapshots', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const source = new EventEmitter();
  let view = snapshot(0);
  let reads = 0;
  const playbackPath = require.resolve('../services/playback');
  const feedPath = require.resolve('../services/playbackFeed');
  const previous = require.cache[playbackPath];
  const previousFeed = require.cache[feedPath];
  require.cache[playbackPath] = {
    exports: {
      async getSnapshot(userId) {
        assert.equal(userId, 12);
        reads++;
        return view;
      },
      subscribe(userId, listener) {
        source.on(String(userId), listener);
        return () => source.off(String(userId), listener);
      },
    },
  };
  delete require.cache[feedPath];
  const { watchPlayback } = require(feedPath);
  const a = [];
  const b = [];
  const onFrame = target => frame => target.push(JSON.parse(frame.payload.split('\n')[1].slice(6)));
  const stopA = watchPlayback(12, onFrame(a));
  const stopB = watchPlayback(12, onFrame(b));
  t.after(() => {
    stopA();
    stopB();
    if (previous) require.cache[playbackPath] = previous;
    else delete require.cache[playbackPath];
    if (previousFeed) require.cache[feedPath] = previousFeed;
    else delete require.cache[feedPath];
  });

  await Promise.resolve();
  t.mock.timers.tick(40);
  assert.equal(reads, 1);
  assert.deepEqual(a, [view]);
  assert.deepEqual(b, a);

  source.emit('12', snapshot(1));
  source.emit('12', snapshot(2));
  source.emit('12', snapshot(1, 60_000, 30_000));
  await Promise.resolve();
  assert.equal(reads, 1);
  assert.deepEqual(a.map(value => value.session.version), [0, 2]);
  assert.deepEqual(b, a);

  source.emit('12', snapshot(2, 70_000, 30_000));
  await Promise.resolve();
  assert.equal(a.length, 2, 'heartbeat delivery is still coalesced');
  t.mock.timers.tick(40);
  assert.equal(a.at(-1).session.leaseUntil, 70_000);

  view = snapshot(3);
  source.emit('12');
  source.emit('12');
  t.mock.timers.tick(40);
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(40);
  assert.equal(reads, 2);
  assert.equal(a.at(-1).session.version, 3);

  view = snapshot(4);
  t.mock.timers.tick(10_000);
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(40);
  assert.equal(reads, 3);
  assert.equal(a.at(-1).session.version, 4);
  assert.deepEqual(b, a);

  stopA();
  stopB();
  t.mock.timers.tick(20_000);
  assert.equal(source.listenerCount('12'), 0);
  assert.equal(reads, 3);
});
