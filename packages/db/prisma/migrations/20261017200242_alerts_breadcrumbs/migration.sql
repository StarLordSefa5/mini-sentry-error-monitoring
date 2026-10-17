-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "breadcrumbs" JSONB;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "alertWebhookUrl" TEXT;
