BEGIN;

CREATE TABLE public."PlaybackSession" (
    "userId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "activeDeviceId" UUID,
    "pendingDeviceId" UUID,
    "leaseUntil" TIMESTAMP(3),
    "handoffResume" BOOLEAN NOT NULL DEFAULT false,
    "trackId" INTEGER,
    "duration" INTEGER,
    "queue" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "queueIndex" INTEGER NOT NULL DEFAULT -1,
    "shuffleOrder" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "playing" BOOLEAN NOT NULL DEFAULT false,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shuffle" BOOLEAN NOT NULL DEFAULT false,
    "repeat" TEXT NOT NULL DEFAULT 'none',
    CONSTRAINT "PlaybackSession_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "PlaybackSession_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE public."PlaybackDevice" (
    "userId" INTEGER NOT NULL,
    "id" UUID NOT NULL,
    "keyHash" CHAR(64) NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaybackDevice_pkey" PRIMARY KEY ("userId", "id"),
    CONSTRAINT "PlaybackDevice_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PlaybackDevice_userId_lastSeenAt_idx" ON public."PlaybackDevice"("userId", "lastSeenAt");

ALTER TABLE public."PlaybackSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PlaybackDevice" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."PlaybackSession", public."PlaybackDevice" FROM PUBLIC;
DO $$
DECLARE
    api_role text;
BEGIN
    FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
        EXECUTE format('REVOKE ALL ON public."PlaybackSession", public."PlaybackDevice" FROM %I', api_role);
    END LOOP;
END $$;

COMMIT;
