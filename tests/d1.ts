import { DatabaseSync } from "node:sqlite";

/**
 * Minimal D1 adapter over Node's built-in SQLite, used only by the test suite.
 * It implements the subset of the D1 API this Worker uses: prepare/bind/first/
 * all/run/batch/exec, including `meta.changes` and `RETURNING` support.
 */

type Row = Record<string, unknown>;

interface D1Meta {
  changes: number;
  last_row_id: number;
  changed_db: boolean;
  duration: number;
  rows_read: number;
  rows_written: number;
  size_after: number;
}

interface D1ResultLike<T> {
  results: T[];
  success: true;
  meta: D1Meta;
}

function meta(changes: number, lastRowId: number): D1Meta {
  return {
    changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    duration: 0,
    rows_read: 0,
    rows_written: changes,
    size_after: 0,
  };
}

function normalizeParams(values: unknown[]): unknown[] {
  return values.map((value) => (value === undefined ? null : value));
}

export class D1Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1Statement {
    return new D1Statement(this.db, this.sql, normalizeParams(values));
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.params as never[])) as Row | undefined;
    if (!row) return null;
    if (column) return (row[column] ?? null) as T;
    return row as T;
  }

  async all<T = unknown>(): Promise<D1ResultLike<T>> {
    const rows = this.db.prepare(this.sql).all(...(this.params as never[])) as T[];
    return { results: rows, success: true, meta: meta(0, 0) };
  }

  async run<T = unknown>(): Promise<D1ResultLike<T>> {
    const info = this.db.prepare(this.sql).run(...(this.params as never[]));
    return {
      results: [],
      success: true,
      meta: meta(Number(info.changes), Number(info.lastInsertRowid)),
    };
  }
}

export class D1Sqlite {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string): D1Statement {
    return new D1Statement(this.db, sql);
  }

  async batch(statements: D1Statement[]): Promise<D1ResultLike<unknown>[]> {
    const results: D1ResultLike<unknown>[] = [];
    for (const statement of statements) {
      results.push(await statement.all());
    }
    return results;
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}
