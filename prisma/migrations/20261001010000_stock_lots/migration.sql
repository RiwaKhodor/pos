-- Stock lots: the same item can sit in more than one container.

CREATE TABLE "StockLot" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "containerId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "customsDuty" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleItemAllocation" (
    "id" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "stockLotId" TEXT,
    "containerId" TEXT,
    "containerCode" TEXT,
    "quantity" INTEGER NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "customsDuty" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,4) NOT NULL DEFAULT 0,

    CONSTRAINT "SaleItemAllocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockLot_productId_receivedAt_idx" ON "StockLot"("productId", "receivedAt");
CREATE INDEX "SaleItemAllocation_saleItemId_idx" ON "SaleItemAllocation"("saleItemId");

ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleItemAllocation" ADD CONSTRAINT "SaleItemAllocation_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleItemAllocation" ADD CONSTRAINT "SaleItemAllocation_stockLotId_fkey" FOREIGN KEY ("stockLotId") REFERENCES "StockLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing stock becomes one lot so current quantities and costs stay intact.
INSERT INTO "StockLot" ("id", "productId", "containerId", "quantity", "cost", "customsDuty", "receivedAt", "createdAt")
SELECT
    'lot_' || "id",
    "id",
    "containerId",
    GREATEST("stock", 0),
    "cost",
    "customsDuty",
    "createdAt",
    "createdAt"
FROM "Product"
WHERE "stock" > 0 OR "containerId" IS NOT NULL;
