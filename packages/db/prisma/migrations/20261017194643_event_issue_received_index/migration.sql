-- DropIndex
DROP INDEX "Event_issueId_timestamp_idx";

-- CreateIndex
CREATE INDEX "Event_issueId_receivedAt_idx" ON "Event"("issueId", "receivedAt");
