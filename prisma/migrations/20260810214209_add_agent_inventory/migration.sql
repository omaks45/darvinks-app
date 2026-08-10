-- CreateTable
CREATE TABLE "AgentInventory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityCartons" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentInventory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentInventory_userId_idx" ON "AgentInventory"("userId");

-- CreateIndex
CREATE INDEX "AgentInventory_productId_idx" ON "AgentInventory"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentInventory_userId_productId_key" ON "AgentInventory"("userId", "productId");

-- AddForeignKey
ALTER TABLE "AgentInventory" ADD CONSTRAINT "AgentInventory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentInventory" ADD CONSTRAINT "AgentInventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
