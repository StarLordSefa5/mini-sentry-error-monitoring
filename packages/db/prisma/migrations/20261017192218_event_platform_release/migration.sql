/*
  Warnings:

  - Added the required column `platform` to the `Event` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "environment" TEXT,
ADD COLUMN     "platform" TEXT NOT NULL,
ADD COLUMN     "release" TEXT,
ADD COLUMN     "stack" TEXT;
