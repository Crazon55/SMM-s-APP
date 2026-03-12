import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { schemaSql } from "./schemaEmbed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (!db) {
    const baseDataDir = process.env.DATA_DIR || join(__dirname, "../../data");
    const dbFilePath = dbPath ?? join(baseDataDir, "dos.db");
    if (!existsSync(baseDataDir)) mkdirSync(baseDataDir, { recursive: true });
    db = new Database(dbFilePath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

export function initDb(dbPath?: string): void {
  const database = getDb(dbPath);
  database.exec(schemaSql);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
