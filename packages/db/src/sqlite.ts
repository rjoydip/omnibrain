import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SqlClient, SqlStatement } from "./sql";

const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations");

export interface SqliteClient extends SqlClient {
  raw: Database;
  exec(sql: string): void;
  close(): void;
}

/**
 * Local/dev adapter. Used by the Bun dev server and repository tests so the
 * exact production SQL (including FTS5 triggers) is exercised without Miniflare.
 */
export function createSqliteClient(path = ":memory:"): SqliteClient {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  const client: SqliteClient = {
    raw: db,
    exec(sql) {
      db.exec(sql);
    },
    async all<T>(sql: string, params: unknown[] = []) {
      return db.query(sql).all(...(params as never[])) as T[];
    },
    async first<T>(sql: string, params: unknown[] = []) {
      return (db.query(sql).get(...(params as never[])) ?? null) as T | null;
    },
    async run(sql: string, params: unknown[] = []) {
      db.query(sql).run(...(params as never[]));
    },
    async batch(statements: SqlStatement[]) {
      const tx = db.transaction(() => {
        for (const s of statements) db.query(s.sql).run(...((s.params ?? []) as never[]));
      });
      tx();
    },
    close() {
      db.close();
    },
  };
  return client;
}

export function migrate(db: SqliteClient): void {
  db.exec(
    "create table if not exists __dev_migrations (name text primary key, applied_at integer not null)",
  );
  const applied = new Set(
    db.raw
      .query("select name from __dev_migrations")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  // Adopt databases created before the migration ledger existed.
  const hasUsers = db.raw
    .query("select name from sqlite_master where type = 'table' and name = 'users'")
    .get();
  if (hasUsers && applied.size === 0) {
    db.raw
      .query("insert into __dev_migrations(name, applied_at) values(?, ?)")
      .run("0001_init.sql", Date.now());
    applied.add("0001_init.sql");
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .toSorted();
  for (const file of files) {
    if (applied.has(file)) continue;
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    db.raw
      .query("insert into __dev_migrations(name, applied_at) values(?, ?)")
      .run(file, Date.now());
  }
}

export function memoryClient(): SqliteClient {
  const db = createSqliteClient();
  migrate(db);
  return db;
}
