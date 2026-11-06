import { spawn } from "child_process";
import path from "path";

export function showPriceOnDisplay(amount: number) {
  const text = Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
  const scriptPath = path.join(process.cwd(), "scripts", "show-price.ps1");
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-Amount",
      text,
    ],
    { windowsHide: true, stdio: "ignore" }
  );
  child.unref();
  child.on("error", () => undefined);
}
