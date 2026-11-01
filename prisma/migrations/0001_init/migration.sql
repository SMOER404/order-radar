-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Source" AS ENUM ('FL', 'KWORK', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'FILTERED_OUT', 'PASSED', 'SCORED', 'REJECTED', 'NOTIFIED', 'INTERESTING', 'SKIPPED', 'ERROR');

-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "source" "Source" NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "budgetRub" INTEGER,
    "budgetText" TEXT,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "filterReason" TEXT,
    "nicheTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fit" TEXT,
    "fitReason" TEXT,
    "estHours" DOUBLE PRECISION,
    "estRateRub" INTEGER,
    "redFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "draftReply" TEXT,
    "llmRaw" JSONB,
    "scoreAttempts" INTEGER NOT NULL DEFAULT 0,
    "tgMessageId" INTEGER,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceState" (
    "key" TEXT NOT NULL,
    "cursor" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastOkAt" TIMESTAMP(3),
    "alertedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Order_contentHash_idx" ON "Order"("contentHash");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_source_externalId_key" ON "Order"("source", "externalId");

