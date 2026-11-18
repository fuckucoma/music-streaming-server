BEGIN;

CREATE INDEX "Favorite_trackId_idx" ON "Favorite"("trackId");
CREATE INDEX "Review_trackId_idx" ON "Review"("trackId");
CREATE INDEX "Review_userId_idx" ON "Review"("userId");
CREATE INDEX "Complaint_userId_idx" ON "Complaint"("userId");

ALTER TABLE "Track" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Favorite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Complaint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    api_role text;
BEGIN
    -- The Express catalog already publishes these track records; other data stays behind its API.
    FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
        EXECUTE format('GRANT SELECT ON TABLE public."Track" TO %I', api_role);
        EXECUTE format(
            'CREATE POLICY %I ON public."Track" FOR SELECT TO %I USING (true)',
            'catalog_read_' || api_role, api_role
        );
        EXECUTE format(
            'REVOKE ALL ON TABLE public."User", public."Favorite", public."Review", public."Complaint" FROM %I',
            api_role
        );
        IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
            EXECUTE format('REVOKE ALL ON TABLE public."_prisma_migrations" FROM %I', api_role);
        END IF;
        EXECUTE format(
            'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public."Track" FROM %I',
            api_role
        );
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
        AND NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'Track'
        ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public."Track";
    END IF;
END $$;

COMMIT;
