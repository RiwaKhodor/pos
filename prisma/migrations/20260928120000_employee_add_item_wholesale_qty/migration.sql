-- AlterTable
ALTER TABLE "Product" ADD COLUMN "wholesaleMinQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "wholesaleMaxQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN "addItemPasswordHash" TEXT;
