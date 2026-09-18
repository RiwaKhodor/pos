import fs from "fs";

const path = ".env";
const lines = fs.readFileSync(path, "utf8").split(/\r?\n/);
const out = lines.map((line) => {
  if (!line.startsWith("DATABASE_URL=")) return line;
  let v = line.slice("DATABASE_URL=".length);
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  v = v.replace(":6543/", ":5432/");
  v = v.replace("?pgbouncer=true&", "?");
  v = v.replace("?pgbouncer=true", "");
  v = v.replace("&pgbouncer=true", "");
  if (!v.includes("sslmode=")) {
    v += v.includes("?") ? "&sslmode=require" : "?sslmode=require";
  }
  return `DATABASE_URL="${v}"`;
});
fs.writeFileSync(path, out.join("\n"));
console.log("DATABASE_URL updated to session pooler :5432");
