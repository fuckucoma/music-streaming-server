const { getSnapshot, subscribe } = require('./playback');

const feeds = new Map();
const COALESCE_MS = 40;
const FALLBACK_MS = 10_000;

function eventKey(snapshot) {
  const { session, devices, serverTime } = snapshot;
  const roster = devices
    .map(({ id, name, platform, online }) => [id, name, platform, online])
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([
    session.version, session.playing, session.positionAt,
    session.leaseUntil > serverTime, Math.floor((session.leaseUntil ?? 0) / 10_000), roster,
  ]);
}

function isOlder(candidate, current) {
  if (!current) return false;
  for (const [a, b] of [
    [candidate.session.version, current.session.version],
    [candidate.session.leaseUntil ?? 0, current.session.leaseUntil ?? 0],
    [candidate.session.positionAt, current.session.positionAt],
    [candidate.serverTime, current.serverTime],
  ]) {
    if (a !== b) return a < b;
  }
  return false;
}

function createFeed(userId) {
  const listeners = new Set();
  let latest;
  let lastKey;
  let refreshing = false;
  let invalidated = false;
  let closed = false;
  let refreshTimer;
  let deliveryTimer;
  let immediateDelivery = false;

  function schedule(delay) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, delay);
  }

  function deliver() {
    if (closed) return;
    const key = eventKey(latest);
    if (key === lastKey) return;
    lastKey = key;
    const frame = { key, payload: `event: session\ndata: ${JSON.stringify(latest)}\n\n` };
    for (const listener of listeners) listener(frame);
  }

  function queueDelivery(versionChanged) {
    if (immediateDelivery) return;
    if (versionChanged) {
      clearTimeout(deliveryTimer);
      deliveryTimer = undefined;
      immediateDelivery = true;
      queueMicrotask(() => {
        immediateDelivery = false;
        deliver();
      });
      return;
    }
    if (deliveryTimer) return;
    deliveryTimer = setTimeout(() => {
      deliveryTimer = undefined;
      deliver();
    }, COALESCE_MS);
  }

  function accept(snapshot) {
    if (closed || isOlder(snapshot, latest)) return;
    const versionChanged = latest && snapshot.session.version !== latest.session.version;
    latest = snapshot;
    queueDelivery(versionChanged);
    if (!refreshing && !invalidated) schedule(FALLBACK_MS);
  }

  async function refresh() {
    if (closed || refreshing) return;
    invalidated = false;
    refreshing = true;
    try {
      accept(await getSnapshot(userId));
    } catch (error) {
      console.warn('Playback event stream refresh failed:', error.code || error.name);
    } finally {
      refreshing = false;
      if (!closed) schedule(invalidated ? COALESCE_MS : FALLBACK_MS);
    }
  }

  const unsubscribe = subscribe(userId, snapshot => {
    if (snapshot) {
      accept(snapshot);
    } else {
      if (!invalidated && !refreshing) schedule(COALESCE_MS);
      invalidated = true;
    }
  });

  return listener => {
    listeners.add(listener);
    if (latest) {
      listener({ key: eventKey(latest), payload: `event: session\ndata: ${JSON.stringify(latest)}\n\n` });
    } else if (!refreshing) {
      void refresh();
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size || closed) return;
      closed = true;
      clearTimeout(refreshTimer);
      clearTimeout(deliveryTimer);
      unsubscribe();
      feeds.delete(userId);
    };
  };
}

function watchPlayback(userId, listener) {
  if (!feeds.has(userId)) feeds.set(userId, createFeed(userId));
  return feeds.get(userId)(listener);
}

module.exports = { watchPlayback };
