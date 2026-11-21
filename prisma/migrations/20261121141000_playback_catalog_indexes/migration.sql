BEGIN;

CREATE INDEX "PlaybackSession_trackId_idx" ON public."PlaybackSession"("trackId");
CREATE INDEX "PlaybackSession_queue_idx" ON public."PlaybackSession" USING GIN ("queue");

COMMIT;
