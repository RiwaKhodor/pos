import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
  prismaWarm?: Promise<void>;
};

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    transactionOptions: {
      maxWait: 10000,
      timeout: 20000,
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Keep one warm connection so the first click is not a cold connect (~1–2s).
if (!globalForPrisma.prismaWarm) {
  globalForPrisma.prismaWarm = prisma.$connect().catch(() => undefined);
}
