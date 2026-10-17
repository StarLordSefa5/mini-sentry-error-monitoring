-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "culprit" TEXT;

-- CreateIndex
CREATE INDEX "Issue_projectId_status_lastSeen_idx" ON "Issue"("projectId", "status", "lastSeen");
