import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (!db) {
    const baseDataDir = process.env.DATA_DIR || join(__dirname, "../../data");
const path = dbPath ?? join(baseDataDir, "dos.db");
    db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

export function initDb(dbPath?: string): void {
  const database = getDb(dbPath);
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  database.exec(schema);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
