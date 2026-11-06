import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { code128Bars } from "@/lib/code128";

export type LabelToPrint = {
  name: string;
  price: string;
  barcode: string;
};

export type LabelPrintResult = {
  printer: string;
  mode: "label";
  count: number;
};

export function printLabelsWindows(labels: LabelToPrint[]) {
  const jsonPath = path.join(
    os.tmpdir(),
    `vano-labels-${Date.now()}.json`
  );
  const scriptPath = path.join(process.cwd(), "scripts", "print-label.ps1");
  const prepared = labels.map((label) => ({
    ...label,
    bars: code128Bars(label.barcode, 0),
  }));
  fs.writeFileSync(jsonPath, JSON.stringify({ labels: prepared }), "utf8");

  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-JsonPath",
    jsonPath,
  ];

  return new Promise<LabelPrintResult>((resolve, reject) => {
    const child = spawn("powershell.exe", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        fs.unlinkSync(jsonPath);
      } catch {
        // ignore temp cleanup
      }
      if (code !== 0) {
        const message = stderr.trim() || stdout.trim() || `Print failed (${code})`;
        if (message.includes("NO_LABEL_PRINTER")) {
          reject(
            new Error(
              "Label printer is not connected. Plug in the Xprinter label printer, then try again."
            )
          );
          return;
        }
        reject(new Error(message));
        return;
      }
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
      try {
        const parsed = JSON.parse(line) as LabelPrintResult;
        resolve({
          printer: parsed.printer || "Label Printer",
          mode: "label",
          count: Number(parsed.count) || labels.length,
        });
      } catch {
        resolve({ printer: "Label Printer", mode: "label", count: labels.length });
      }
    });
  });
}
