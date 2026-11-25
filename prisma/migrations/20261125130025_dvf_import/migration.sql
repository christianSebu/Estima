-- CreateTable
CREATE TABLE "DvfImport" (
    "department" TEXT NOT NULL,
    "years" INTEGER[],
    "sourceSignature" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DvfImport_pkey" PRIMARY KEY ("department")
);
