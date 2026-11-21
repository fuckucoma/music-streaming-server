const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');

const database = process.env.TEST_DATABASE_URL;
test('deleting a track updates shared queues and stops a deleted current track', {
  skip: !database && 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database',
  timeout: 20_000,
}, async () => {
  process.env.DATABASE_URL = database;
  process.env.DIRECT_URL = database;
  const prisma = require('../lib/prisma');
  const { deleteTrack } = require('../services/tracks');
  let userId;
  let ids = [];

  try {
    const user = await prisma.user.create({ data: { username: `catalog-audit-${randomUUID()}` } });
    userId = user.id;
    const tracks = await prisma.track.createManyAndReturn({
      data: ['A', 'B', 'C'].map(title => ({ title, artist: 'Audit fixture', filename: 'fixture.mp3' })),
    });
    ids = tracks.map(track => track.id);
    const [first, middle, last] = ids;
    const timelineRevision = randomUUID();
    await prisma.playbackSession.create({
      data: {
        userId, trackId: first, queue: ids, queueIndex: 0, playing: true, timelineRevision,
        shuffle: true, shuffleOrder: [2, 0, 1],
      },
    });

    await deleteTrack(middle);
    const afterRemoval = await prisma.playbackSession.findUniqueOrThrow({ where: { userId } });
    assert.deepEqual(afterRemoval.queue, [first, last]);
    assert.deepEqual(afterRemoval.shuffleOrder, [1, 0]);
    assert.equal(afterRemoval.queueIndex, 0);
    assert.equal(afterRemoval.trackId, first);
    assert.equal(afterRemoval.playing, true);
    assert.equal(afterRemoval.version, 1);
    assert.equal(afterRemoval.timelineRevision, timelineRevision);

    await deleteTrack(first);
    const afterStop = await prisma.playbackSession.findUniqueOrThrow({ where: { userId } });
    assert.deepEqual(afterStop.queue, [last]);
    assert.deepEqual(afterStop.shuffleOrder, [0]);
    assert.equal(afterStop.queueIndex, -1);
    assert.equal(afterStop.trackId, null);
    assert.equal(afterStop.playing, false);
    assert.equal(afterStop.position, 0);
    assert.equal(afterStop.version, 2);
    assert.notEqual(afterStop.timelineRevision, timelineRevision);
  } finally {
    try {
      if (userId) await prisma.user.delete({ where: { id: userId } });
      if (ids.length) await prisma.track.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await prisma.$disconnect();
    }
  }
});
