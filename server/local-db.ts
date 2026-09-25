import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Database, Statement } from "./store";

export function localDatabase(filename = ".sites-runtime/online.sqlite") {
  if (filename !== ":memory:")
    mkdirSync(dirname(resolve(filename)), { recursive: true });
  const sqlite = new DatabaseSync(filename);
  sqlite.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)",
  );
  for (const name of readdirSync("drizzle")
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      sqlite.prepare("SELECT name FROM local_migrations WHERE name=?").get(name)
    )
      continue;
    sqlite.exec("BEGIN");
    try {
      sqlite.exec(readFileSync(resolve("drizzle", name), "utf8"));
      sqlite
        .prepare("INSERT INTO local_migrations (name) VALUES (?)")
        .run(name);
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  sqlite.exec("PRAGMA optimize");
  class LocalStatement implements Statement {
    constructor(
      private sql: string,
      private values: SQLInputValue[] = [],
    ) {}
    bind(...values: unknown[]) {
      return new LocalStatement(this.sql, values as SQLInputValue[]);
    }
    async first<T>() {
      return (sqlite.prepare(this.sql).get(...this.values) ?? null) as T | null;
    }
    execute() {
      return sqlite.prepare(this.sql).run(...this.values);
    }
    async run() {
      return this.execute();
    }
  }
  const db: Database = {
    prepare: (sql) => new LocalStatement(sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => (s as LocalStatement).execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db, sqlite, close: () => sqlite.close() };
}
