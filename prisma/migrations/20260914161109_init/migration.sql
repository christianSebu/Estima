-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APPARTEMENT', 'MAISON');

-- CreateEnum
CREATE TYPE "PropertyCondition" AS ENUM ('NEUF', 'BON_ETAT', 'A_RENOVER');

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "inseeCode" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "surface" DOUBLE PRECISION NOT NULL,
    "rooms" INTEGER NOT NULL,
    "floor" INTEGER,
    "hasElevator" BOOLEAN,
    "hasOutdoor" BOOLEAN,
    "hasParking" BOOLEAN,
    "condition" "PropertyCondition",
    "dpeClass" TEXT,
    "sourceApp" TEXT NOT NULL,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Valuation" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "estimatedValue" DOUBLE PRECISION NOT NULL,
    "pricePerSqm" DOUBLE PRECISION NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "comparablesUsed" INTEGER NOT NULL,
    "methodology" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Valuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DvfTransactionCache" (
    "id" TEXT NOT NULL,
    "inseeCode" TEXT NOT NULL,
    "section" TEXT,
    "propertyType" "PropertyType" NOT NULL,
    "surface" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "pricePerSqm" DOUBLE PRECISION NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "DvfTransactionCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_sourceApp_externalRef_idx" ON "Property"("sourceApp", "externalRef");

-- CreateIndex
CREATE INDEX "Valuation_propertyId_idx" ON "Valuation"("propertyId");

-- CreateIndex
CREATE INDEX "DvfTransactionCache_inseeCode_propertyType_idx" ON "DvfTransactionCache"("inseeCode", "propertyType");

-- AddForeignKey
ALTER TABLE "Valuation" ADD CONSTRAINT "Valuation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
