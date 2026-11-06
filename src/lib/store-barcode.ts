export function newStoreBarcode(taken: Set<string>) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const n = Math.floor(Math.random() * 1e10);
    const code = `20${String(n).padStart(10, "0")}`;
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
  throw new Error("Could not create a unique barcode");
}
