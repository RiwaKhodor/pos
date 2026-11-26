import { spawnSync } from "child_process";
import { readFileSync } from "fs";

const token = readFileSync("build/github-update.token", "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .find((line) => line && !line.startsWith("#"));
if (!token) {
  console.error("Missing GitHub token file.");
  process.exit(1);
}

const result = spawnSync(
  "npx",
  ["electron-builder", "--win", "nsis", "--publish", "always"],
  {
    stdio: "inherit",
    env: { ...process.env, GH_TOKEN: token },
    shell: true,
  }
);
process.exit(result.status ?? 1);
