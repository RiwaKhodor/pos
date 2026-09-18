import fs from "fs";

const path = ".env";
const lines = fs.readFileSync(path, "utf8").split(/\r?\n/);

function withTimeout(url) {
  if (url.includes("connect_timeout=")) return url;
  return url.includes("?")
    ? `${url}&connect_timeout=30`
    : `${url}?connect_timeout=30`;
}

const out = lines.map((line) => {
  if (!line.startsWith("DATABASE_URL=") && !line.startsWith("DIRECT_URL=")) {
    return line;
  }
  const eq = line.indexOf("=");
  const key = line.slice(0, eq);
  let v = line.slice(eq + 1);
  const quoted = v.startsWith('"') && v.endsWith('"');
  if (quoted) v = v.slice(1, -1);
  v = withTimeout(v);
  return `${key}="${v}"`;
});

fs.writeFileSync(path, out.join("\n"));
console.log("Added connect_timeout=30 to DB URLs");
