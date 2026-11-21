BEGIN;

ALTER TABLE public."User" ADD COLUMN "telegramAuthVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE public."TelegramLinkCode" (
    "userId" INTEGER NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "TelegramLinkCode_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TelegramLinkCode_codeHash_key" ON public."TelegramLinkCode"("codeHash");
CREATE INDEX "TelegramLinkCode_expiresAt_idx" ON public."TelegramLinkCode"("expiresAt");

ALTER TABLE public."TelegramLinkCode" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."TelegramLinkCode" FROM PUBLIC;
DO $$
DECLARE
    api_role text;
BEGIN
    FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
        EXECUTE format('REVOKE ALL ON public."TelegramLinkCode" FROM %I', api_role);
    END LOOP;
END $$;

COMMIT;
