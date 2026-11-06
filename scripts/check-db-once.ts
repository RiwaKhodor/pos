import { PrismaClient } from "@prisma/client";

function kind(error: unknown) {
  const rec = error as { code?: string; errorCode?: string; message?: string };
  const msg = String(rec.message || error);
  if (/tenant\/user .+ not found|not found/i.test(msg)) return "paused-or-missing";
  if (/ECHECKOUTTIMEOUT|unable to check out/i.test(msg)) return "pool-timeout";
  if (/P1001|Can't reach|ENOTFOUND|ETIMEDOUT/i.test(msg)) return "unreachable";
  return rec.code || rec.errorCode || "other";
}

async function tryUrl(label: string, url?: string) {
  if (!url) {
    console.log(label, "missing");
    return;
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.user.count();
    console.log(label, "ok");
  } catch (error) {
    console.log(label, kind(error));
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await tryUrl("pooler", process.env.DATABASE_URL);
  await tryUrl("direct", process.env.DIRECT_URL);
}

main();
