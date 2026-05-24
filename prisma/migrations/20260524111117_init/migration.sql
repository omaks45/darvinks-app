-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('TIER1', 'TIER2', 'TIER3', 'TIER4', 'TIER5_SALES_HEAD', 'TIER5_SYSTEM_ADMIN', 'TIER5_WAREHOUSE', 'TIER6_GM');

-- CreateEnum
CREATE TYPE "Team" AS ENUM ('BRIGHT', 'RADIANT');

-- CreateEnum
CREATE TYPE "Region" AS ENUM ('NORTH_BRIGHT', 'SS1', 'SS2', 'SS3', 'SE1', 'LAGOS_1', 'LAGOS_2', 'NORTH_CENTRAL', 'NORTH_WEST', 'SOUTH_WEST', 'MODERN_TRADE');

-- CreateEnum
CREATE TYPE "AttendanceType" AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'KD_VISIT');

-- CreateEnum
CREATE TYPE "AttendanceFlag" AS ENUM ('ON_TIME', 'LATE', 'MISSED', 'OUTSIDE_WINDOW');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('CREAM', 'SOAP', 'LOTION', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "LotionUnit" AS ENUM ('PIECE', 'ROW', 'CARTON');

-- CreateEnum
CREATE TYPE "WarehouseLocation" AS ENUM ('LAGOS_HQ', 'ONITSHA', 'KANO');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('INBOUND', 'OUTBOUND_PO', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'PAYMENT_RECEIVED', 'DO_UPLOADED', 'DELIVERED', 'FULLY_PAID', 'DEFAULTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceQualification" AS ENUM ('PENDING', 'QUALIFIED', 'NOT_QUALIFIED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'TRANSFER', 'CHEQUE');

-- CreateEnum
CREATE TYPE "BuyerType" AS ENUM ('SUB_DISTRIBUTOR', 'WHOLESALER', 'RETAILER');

-- CreateEnum
CREATE TYPE "CompetitorReportMediaType" AS ENUM ('PDF', 'IMAGE', 'VIDEO', 'TEXT');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('FCM', 'EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "employeeRef" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "tier" "UserTier" NOT NULL,
    "team" "Team" NOT NULL,
    "region" "Region" NOT NULL,
    "state" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "profilePictureUrl" TEXT,
    "idCardUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fcmToken" TEXT,
    "annualTargets" JSONB NOT NULL DEFAULT '{}',
    "warehouseLocation" "WarehouseLocation",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedBy" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AttendanceType" NOT NULL,
    "flag" "AttendanceFlag" NOT NULL DEFAULT 'ON_TIME',
    "photoUrl" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "deviceTime" TIMESTAMP(3) NOT NULL,
    "serverTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kdAccountId" TEXT,
    "note" TEXT,

    CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "packQty" INTEGER NOT NULL,
    "unitPriceKobo" INTEGER NOT NULL,
    "cartonPriceKobo" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "mobilePhone" TEXT NOT NULL,
    "whatsApp" TEXT,
    "email" TEXT,
    "cacNumber" TEXT,
    "contactPerson" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactPosition" TEXT,
    "region" "Region" NOT NULL,
    "state" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "balanceKobo" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutOfRegionRequest" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutOfRegionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockEntry" (
    "id" TEXT NOT NULL,
    "warehouseLocation" "WarehouseLocation" NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityCartons" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "warehouseLocation" "WarehouseLocation" NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantityCartons" INTEGER NOT NULL,
    "batchReference" TEXT,
    "reasonNote" TEXT,
    "purchaseOrderId" TEXT,
    "recordedById" TEXT NOT NULL,
    "adjustedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "orderRef" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "warehouseLocation" "WarehouseLocation" NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "qualification" "InvoiceQualification" NOT NULL DEFAULT 'PENDING',
    "subtotalKobo" INTEGER NOT NULL,
    "creditAppliedKobo" INTEGER NOT NULL DEFAULT 0,
    "totalKobo" INTEGER NOT NULL,
    "paidKobo" INTEGER NOT NULL DEFAULT 0,
    "cashDiscountKobo" INTEGER NOT NULL DEFAULT 0,
    "incentiveKobo" INTEGER NOT NULL DEFAULT 0,
    "kdInvoiceUrl" TEXT,
    "chequeUrl" TEXT,
    "formalInvoiceUrl" TEXT,
    "deliveryOrderUrl" TEXT,
    "invoiceMismatch" JSONB,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "deliveredById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "paymentDeadline" TIMESTAMP(3),
    "fullyPaidAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityCartons" INTEGER NOT NULL,
    "unitPriceKobo" INTEGER NOT NULL,
    "lineTotalKobo" INTEGER NOT NULL,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "proofUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "receiptUrl" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "depositorName" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecondarySale" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kdAccountId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "deviceTime" TIMESTAMP(3) NOT NULL,
    "serverTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecondarySale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecondarySaleItem" (
    "id" TEXT NOT NULL,
    "secondarySaleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "buyerType" "BuyerType" NOT NULL,
    "quantityCartons" INTEGER NOT NULL DEFAULT 0,
    "quantityRows" INTEGER NOT NULL DEFAULT 0,
    "quantityPieces" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SecondarySaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorReport" (
    "id" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "region" "Region" NOT NULL,
    "state" TEXT,
    "mediaType" "CompetitorReportMediaType" NOT NULL,
    "mediaUrl" TEXT,
    "textContent" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "sentAt" TIMESTAMP(3),
    "failReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeRef_key" ON "User"("employeeRef");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_tier_idx" ON "User"("tier");

-- CreateIndex
CREATE INDEX "User_team_idx" ON "User"("team");

-- CreateIndex
CREATE INDEX "User_region_idx" ON "User"("region");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_tokenHash_idx" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AttendanceEvent_userId_serverTime_idx" ON "AttendanceEvent"("userId", "serverTime");

-- CreateIndex
CREATE INDEX "AttendanceEvent_userId_deviceTime_idx" ON "AttendanceEvent"("userId", "deviceTime");

-- CreateIndex
CREATE INDEX "AttendanceEvent_type_idx" ON "AttendanceEvent"("type");

-- CreateIndex
CREATE INDEX "AttendanceEvent_flag_idx" ON "AttendanceEvent"("flag");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Product_isActive_idx" ON "Product"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Product_name_category_key" ON "Product"("name", "category");

-- CreateIndex
CREATE INDEX "Customer_ownerId_idx" ON "Customer"("ownerId");

-- CreateIndex
CREATE INDEX "Customer_region_idx" ON "Customer"("region");

-- CreateIndex
CREATE INDEX "Customer_balanceKobo_idx" ON "Customer"("balanceKobo");

-- CreateIndex
CREATE INDEX "OutOfRegionRequest_customerId_idx" ON "OutOfRegionRequest"("customerId");

-- CreateIndex
CREATE INDEX "OutOfRegionRequest_status_idx" ON "OutOfRegionRequest"("status");

-- CreateIndex
CREATE INDEX "StockEntry_warehouseLocation_idx" ON "StockEntry"("warehouseLocation");

-- CreateIndex
CREATE INDEX "StockEntry_quantityCartons_idx" ON "StockEntry"("quantityCartons");

-- CreateIndex
CREATE UNIQUE INDEX "StockEntry_warehouseLocation_productId_key" ON "StockEntry"("warehouseLocation", "productId");

-- CreateIndex
CREATE INDEX "StockMovement_warehouseLocation_createdAt_idx" ON "StockMovement"("warehouseLocation", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_productId_idx" ON "StockMovement"("productId");

-- CreateIndex
CREATE INDEX "StockMovement_type_idx" ON "StockMovement"("type");

-- CreateIndex
CREATE INDEX "StockMovement_purchaseOrderId_idx" ON "StockMovement"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_orderRef_key" ON "PurchaseOrder"("orderRef");

-- CreateIndex
CREATE INDEX "PurchaseOrder_customerId_idx" ON "PurchaseOrder"("customerId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_qualification_idx" ON "PurchaseOrder"("qualification");

-- CreateIndex
CREATE INDEX "PurchaseOrder_warehouseLocation_idx" ON "PurchaseOrder"("warehouseLocation");

-- CreateIndex
CREATE INDEX "PurchaseOrder_createdById_idx" ON "PurchaseOrder"("createdById");

-- CreateIndex
CREATE INDEX "PurchaseOrder_paymentDeadline_idx" ON "PurchaseOrder"("paymentDeadline");

-- CreateIndex
CREATE INDEX "PurchaseOrder_createdAt_idx" ON "PurchaseOrder"("createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");

-- CreateIndex
CREATE INDEX "PaymentRecord_purchaseOrderId_idx" ON "PaymentRecord"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PaymentRecord_createdAt_idx" ON "PaymentRecord"("createdAt");

-- CreateIndex
CREATE INDEX "Collection_customerId_idx" ON "Collection"("customerId");

-- CreateIndex
CREATE INDEX "Collection_recordedById_idx" ON "Collection"("recordedById");

-- CreateIndex
CREATE INDEX "Collection_collectedAt_idx" ON "Collection"("collectedAt");

-- CreateIndex
CREATE INDEX "SecondarySale_userId_deviceTime_idx" ON "SecondarySale"("userId", "deviceTime");

-- CreateIndex
CREATE INDEX "SecondarySale_kdAccountId_idx" ON "SecondarySale"("kdAccountId");

-- CreateIndex
CREATE INDEX "SecondarySaleItem_secondarySaleId_idx" ON "SecondarySaleItem"("secondarySaleId");

-- CreateIndex
CREATE INDEX "SecondarySaleItem_productId_idx" ON "SecondarySaleItem"("productId");

-- CreateIndex
CREATE INDEX "CompetitorReport_submittedById_idx" ON "CompetitorReport"("submittedById");

-- CreateIndex
CREATE INDEX "CompetitorReport_region_idx" ON "CompetitorReport"("region");

-- CreateIndex
CREATE INDEX "CompetitorReport_createdAt_idx" ON "CompetitorReport"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE INDEX "Notification_channel_idx" ON "Notification"("channel");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_kdAccountId_fkey" FOREIGN KEY ("kdAccountId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutOfRegionRequest" ADD CONSTRAINT "OutOfRegionRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutOfRegionRequest" ADD CONSTRAINT "OutOfRegionRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutOfRegionRequest" ADD CONSTRAINT "OutOfRegionRequest_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_adjustedById_fkey" FOREIGN KEY ("adjustedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondarySale" ADD CONSTRAINT "SecondarySale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondarySaleItem" ADD CONSTRAINT "SecondarySaleItem_secondarySaleId_fkey" FOREIGN KEY ("secondarySaleId") REFERENCES "SecondarySale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondarySaleItem" ADD CONSTRAINT "SecondarySaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorReport" ADD CONSTRAINT "CompetitorReport_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
