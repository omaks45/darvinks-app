-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "SecondaryCustomerType" AS ENUM ('SUB_DISTRIBUTOR', 'WHOLESALER', 'RETAILER');

-- CreateEnum
CREATE TYPE "StockCollectionStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "SecondaryInvoiceStatus" AS ENUM ('UNPAID', 'PARTIAL', 'SETTLED');

-- CreateEnum
CREATE TYPE "LedgerStatus" AS ENUM ('UNPAID', 'PARTIAL', 'SETTLED');

-- CreateTable
CREATE TABLE "StockCollection" (
    "id" TEXT NOT NULL,
    "collectionRef" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "StockCollectionStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotalKobo" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT,
    "invoiceUrl" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCollectionItem" (
    "id" TEXT NOT NULL,
    "stockCollectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityCartons" INTEGER NOT NULL,
    "unitPriceKobo" BIGINT NOT NULL,
    "lineTotalKobo" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCollectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecondarySaleInvoice" (
    "id" TEXT NOT NULL,
    "invoiceRef" TEXT NOT NULL,
    "soldById" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "totalKobo" BIGINT NOT NULL,
    "paidKobo" BIGINT NOT NULL DEFAULT 0,
    "balanceKobo" BIGINT NOT NULL,
    "status" "SecondaryInvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "invoiceUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecondarySaleInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecondarySaleInvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityCartons" INTEGER NOT NULL,
    "unitPriceKobo" BIGINT NOT NULL,
    "lineTotalKobo" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecondarySaleInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecondaryPayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecondaryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KdLedgerEntry" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "receiptUrl" TEXT,
    "totalKobo" BIGINT NOT NULL,
    "paidKobo" BIGINT NOT NULL DEFAULT 0,
    "balanceKobo" BIGINT NOT NULL,
    "status" "LedgerStatus" NOT NULL DEFAULT 'UNPAID',
    "ocrExtracted" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KdLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KdPayment" (
    "id" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KdPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockCollection_collectionRef_key" ON "StockCollection"("collectionRef");

-- CreateIndex
CREATE INDEX "StockCollection_userId_idx" ON "StockCollection"("userId");

-- CreateIndex
CREATE INDEX "StockCollection_sourceId_idx" ON "StockCollection"("sourceId");

-- CreateIndex
CREATE INDEX "StockCollection_status_idx" ON "StockCollection"("status");

-- CreateIndex
CREATE INDEX "StockCollection_userId_createdAt_idx" ON "StockCollection"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "StockCollectionItem_stockCollectionId_idx" ON "StockCollectionItem"("stockCollectionId");

-- CreateIndex
CREATE INDEX "StockCollectionItem_productId_idx" ON "StockCollectionItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SecondarySaleInvoice_invoiceRef_key" ON "SecondarySaleInvoice"("invoiceRef");

-- CreateIndex
CREATE INDEX "SecondarySaleInvoice_soldById_idx" ON "SecondarySaleInvoice"("soldById");

-- CreateIndex
CREATE INDEX "SecondarySaleInvoice_customerId_idx" ON "SecondarySaleInvoice"("customerId");

-- CreateIndex
CREATE INDEX "SecondarySaleInvoice_status_idx" ON "SecondarySaleInvoice"("status");

-- CreateIndex
CREATE INDEX "SecondarySaleInvoice_soldById_createdAt_idx" ON "SecondarySaleInvoice"("soldById", "createdAt");

-- CreateIndex
CREATE INDEX "SecondarySaleInvoiceItem_invoiceId_idx" ON "SecondarySaleInvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "SecondarySaleInvoiceItem_productId_idx" ON "SecondarySaleInvoiceItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "KdLedgerEntry_purchaseOrderId_key" ON "KdLedgerEntry"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "KdLedgerEntry_customerId_idx" ON "KdLedgerEntry"("customerId");

-- CreateIndex
CREATE INDEX "KdLedgerEntry_status_idx" ON "KdLedgerEntry"("status");

-- CreateIndex
CREATE INDEX "KdPayment_ledgerEntryId_idx" ON "KdPayment"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "KdPayment_recordedById_idx" ON "KdPayment"("recordedById");

-- AddForeignKey
ALTER TABLE "StockCollection" ADD CONSTRAINT "StockCollection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCollection" ADD CONSTRAINT "StockCollection_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCollectionItem" ADD CONSTRAINT "StockCollectionItem_stockCollectionId_fkey" FOREIGN KEY ("stockCollectionId") REFERENCES "StockCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCollectionItem" ADD CONSTRAINT "StockCollectionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondarySaleInvoice" ADD CONSTRAINT "SecondarySaleInvoice_soldById_fkey" FOREIGN KEY ("soldById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondarySaleInvoice" ADD CONSTRAINT "SecondarySaleInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondarySaleInvoiceItem" ADD CONSTRAINT "SecondarySaleInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SecondarySaleInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondarySaleInvoiceItem" ADD CONSTRAINT "SecondarySaleInvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondaryPayment" ADD CONSTRAINT "SecondaryPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SecondarySaleInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KdLedgerEntry" ADD CONSTRAINT "KdLedgerEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KdLedgerEntry" ADD CONSTRAINT "KdLedgerEntry_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KdPayment" ADD CONSTRAINT "KdPayment_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "KdLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KdPayment" ADD CONSTRAINT "KdPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
