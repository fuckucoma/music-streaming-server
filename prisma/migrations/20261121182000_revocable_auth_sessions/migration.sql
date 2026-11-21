BEGIN;

ALTER TABLE public."User" ADD COLUMN "authSessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE public."AuthLoginMethod" AS ENUM ('password', 'telegram');

CREATE TABLE public."AuthSession" (
    "id" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "method" public."AuthLoginMethod" NOT NULL,
    "authVersion" INTEGER NOT NULL,
    "telegramAuthVersion" INTEGER,
    "userAgent" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AuthSession_userId_expiresAt_idx" ON public."AuthSession"("userId", "expiresAt");

ALTER TABLE public."AuthSession" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."AuthSession" FROM PUBLIC;
DO $$
DECLARE
    api_role text;
BEGIN
    FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
        EXECUTE format('REVOKE ALL ON public."AuthSession" FROM %I', api_role);
    END LOOP;
END $$;

COMMIT;
