// opens a database in the OPFS pool it is told to use and keeps the pool open until terminated
import "../../src/browser/globals.ts";

self.onmessage = async (e: MessageEvent<string>) => {
  try {
    const sqlite = (await import("node:sqlite")) as unknown as typeof import("node:sqlite") & {
      installOpfs(name: string): Promise<{ wipeFiles(): Promise<void>; getFileNames(): string[] }>;
    };
    const pool = await sqlite.installOpfs(e.data);
    await pool.wipeFiles();
    const db = new sqlite.DatabaseSync("/db.sqlite");
    db.exec("CREATE TABLE t (name TEXT); INSERT INTO t VALUES ('" + e.data + "')");
    const rows = db.prepare("SELECT name FROM t").all();
    db.close();
    postMessage({ rows, files: pool.getFileNames() });
  } catch (err) {
    postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
