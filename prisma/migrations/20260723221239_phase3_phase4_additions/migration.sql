-- CreateTable
CREATE TABLE "AnalyticsReport" (
    "id" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "pptUrl" TEXT NOT NULL,
    "xlsxUrl" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsReport_periodMonth_key" ON "AnalyticsReport"("periodMonth");

-- CreateIndex
CREATE INDEX "AnalyticsReport_periodMonth_idx" ON "AnalyticsReport"("periodMonth");
