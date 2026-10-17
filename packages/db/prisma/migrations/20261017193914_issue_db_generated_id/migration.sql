-- AlterTable
ALTER TABLE "Issue" ALTER COLUMN "id" SET DEFAULT (gen_random_uuid())::text;
