declare module "*?raw" {
  const text: string;
  export default text;
}
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...p: unknown[]): { changes: number | bigint };
      get(...p: unknown[]): unknown;
      all(...p: unknown[]): unknown[];
    };
  }
}
declare module 'node:fs' {
  export function readFileSync(path: URL): Uint8Array;
}
