declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...args: unknown[]): { changes: number };
      get(...args: unknown[]): unknown;
      all(...args: unknown[]): unknown[];
    };
  }
}
