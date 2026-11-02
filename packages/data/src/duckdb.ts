import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

// DuckDB の接続と SQL ファイルの実行

export async function openDuckDB(): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await connection.run("INSTALL spatial; LOAD spatial;");
  return connection;
}

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

async function readSql(sqlDir: string, file: string, params: Record<string, string>) {
  const template = await readFile(join(sqlDir, file), "utf8");
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`${file} の {{${key}}} に値がありません`);
    return escapeSqlString(value);
  });
}

export async function runSqlFile(
  connection: DuckDBConnection,
  sqlDir: string,
  file: string,
  params: Record<string, string> = {},
): Promise<void> {
  await connection.run(await readSql(sqlDir, file, params));
}

// 最後の文の結果を JSON 互換の行として返す
export async function querySqlFile<T>(
  connection: DuckDBConnection,
  sqlDir: string,
  file: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const reader = await connection.runAndReadAll(await readSql(sqlDir, file, params));
  return reader.getRowObjectsJson() as T[];
}

export async function createValueTable(
  connection: DuckDBConnection,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): Promise<void> {
  await connection.run(`CREATE TABLE ${table} (${columns.map((c) => `${c} VARCHAR`).join(", ")})`);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  for (const row of rows) {
    await connection.run(`INSERT INTO ${table} VALUES (${placeholders})`, [...row]);
  }
}
