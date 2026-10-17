-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "uploadTokenHash" TEXT;

-- CreateTable
CREATE TABLE "SourceMap" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "release" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SourceMap_projectId_release_filePath_key" ON "SourceMap"("projectId", "release", "filePath");

-- AddForeignKey
ALTER TABLE "SourceMap" ADD CONSTRAINT "SourceMap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
