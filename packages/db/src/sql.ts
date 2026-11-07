export interface SqlStatement {
  sql: string;
  params?: unknown[];
}

export interface SqlClient {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<void>;
  batch(statements: SqlStatement[]): Promise<void>;
}

interface D1Result<T> {
  results: T[];
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Like {
  prepare(sql: string): D1Statement;
  batch?(statements: D1Statement[]): Promise<unknown>;
}

/** Adapts a Cloudflare D1 binding to the small client the repository uses. */
export function fromD1(d1: D1Like): SqlClient {
  const stmt = (sql: string, params: unknown[] = []) =>
    params.length ? d1.prepare(sql).bind(...params) : d1.prepare(sql);

  return {
    async all<T>(sql: string, params: unknown[] = []) {
      const res = await stmt(sql, params).all<T>();
      return res.results;
    },
    async first<T>(sql: string, params: unknown[] = []) {
      return stmt(sql, params).first<T>();
    },
    async run(sql: string, params: unknown[] = []) {
      await stmt(sql, params).run();
    },
    async batch(statements: SqlStatement[]) {
      if (d1.batch) {
        await d1.batch(statements.map((s) => stmt(s.sql, s.params ?? [])));
        return;
      }
      for (const s of statements) await stmt(s.sql, s.params ?? []).run();
    },
  };
}
