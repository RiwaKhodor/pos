import { PrismaClient } from "@prisma/client";
import fs from "fs";

function loadEnv() {
  const out = {};
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let v = line.slice(i + 1);
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[line.slice(0, i)] = v;
  }
  return out;
}

async function tryUrl(label, url) {
  console.log("---", label, "---");
  console.log("len:", url?.length);
  console.log("prefix:", url?.slice(0, 45));
  console.log("hostpart:", url?.split("@")[1]);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const r = await prisma.$queryRawUnsafe("SELECT 1 as ok");
    console.log("RESULT: OK", r);
  } catch (e) {
    console.log("CODE:", e.code);
    console.log("MSG:", e.message);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

const env = loadEnv();
await tryUrl("DATABASE_URL", env.DATABASE_URL);
await tryUrl("DIRECT_URL", env.DIRECT_URL);
