import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Database, Statement } from "../../src/lib/subscriptions.ts";

const migration = readFileSync(
  new URL("../../migrations/0001_create_subscribers.sql", import.meta.url),
  "utf8",
);

class SqliteStatement implements Statement {
  readonly #sqlite: DatabaseSync;
  readonly #query: string;
  readonly #values: SQLInputValue[];

  constructor(sqlite: DatabaseSync, query: string, values: SQLInputValue[] = []) {
    this.#sqlite = sqlite;
    this.#query = query;
    this.#values = values;
  }

  bind(...values: unknown[]): Statement {
    return new SqliteStatement(this.#sqlite, this.#query, values as SQLInputValue[]);
  }

  async first<T>(): Promise<T | null> {
    return (this.#sqlite.prepare(this.#query).get(...this.#values) as T | undefined) ?? null;
  }

  async run() {
    const { changes } = this.#sqlite.prepare(this.#query).run(...this.#values);
    return { meta: { changes: Number(changes) } };
  }
}

/** An in-memory SQLite database with the D1 migration applied, behind the part of D1's API the code uses. */
export function createDatabase(): Database & { sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration);
  return { sqlite, prepare: (query) => new SqliteStatement(sqlite, query) };
}
