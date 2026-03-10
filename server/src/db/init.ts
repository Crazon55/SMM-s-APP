#!/usr/bin/env node
import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { initDb, getDb } from "./index.js";
import { seedPersonas } from "../seeds/personas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "../../data");

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

initDb();
seedPersonas(getDb());
console.log("Database initialized at server/data/dos.db");
