ALTER TABLE "StoreSettings" ALTER COLUMN "usdToLbpRate" SET DEFAULT 89500;
ALTER TABLE "Sale" ALTER COLUMN "exchangeRate" SET DEFAULT 89500;
UPDATE "StoreSettings" SET "usdToLbpRate" = 89500 WHERE "id" = 'default';
