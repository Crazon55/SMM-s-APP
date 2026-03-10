import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { initDb, getDb, closeDb } from "../db/index.js";
import { seedPersonas } from "../seeds/personas.js";
import { generateDailyPlans } from "../services/planGenerator.js";
import { v4 as uuidv4 } from "uuid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDbPath = join(__dirname, "../../data/test-acceptance.db");

describe("Plan correctness (acceptance)", () => {
  beforeAll(() => {
    const dataDir = join(__dirname, "../../data");
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    initDb(testDbPath);
    const db = getDb(testDbPath);
    seedPersonas(db);
    const personaIds = db.prepare("SELECT id FROM personas LIMIT 2").all() as Array<{ id: string }>;
    const opId = uuidv4();
    db.prepare("INSERT INTO operators (id, name, coverage_weekday, coverage_weekend) VALUES (?, ?, 1, 0)").run(opId, "Op1");
    for (let i = 0; i < 7; i++) {
      const devId = uuidv4();
      db.prepare(
        "INSERT INTO devices (id, name, device_unique_id, persona_id, operator_id, status) VALUES (?, ?, ?, ?, ?, 'active')"
      ).run(devId, `Device-${i}`, `dos-${devId.slice(0, 8)}`, personaIds[i % 2].id, i < 4 ? opId : null);
    }
  });

  afterAll(() => {
    closeDb();
    try {
      if (existsSync(testDbPath)) unlinkSync(testDbPath);
    } catch (_) {}
  });

  it("no two devices have session starts within buffer", () => {
    const db = getDb(testDbPath);
    const planDate = "2025-06-15";
    generateDailyPlans(db, planDate);

    const sessions = db
      .prepare(
        `SELECT ps.device_id, ps.planned_start FROM planned_sessions ps
         JOIN daily_plans dp ON ps.daily_plan_id = dp.id WHERE dp.plan_date = ?`
      )
      .all(planDate) as Array<{ device_id: string; planned_start: string }>;

    const bufferMin = 5;
    const parseMins = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    };

    for (let i = 0; i < sessions.length; i++) {
      for (let j = i + 1; j < sessions.length; j++) {
        const a = parseMins(sessions[i].planned_start);
        const b = parseMins(sessions[j].planned_start);
        expect(Math.abs(a - b)).toBeGreaterThanOrEqual(bufferMin);
      }
    }
  });

  it("same-operator devices never share daily mode", () => {
    const db = getDb(testDbPath);
    const planDate = "2025-06-16";
    db.prepare("DELETE FROM planned_sessions WHERE daily_plan_id IN (SELECT id FROM daily_plans WHERE plan_date = ?)").run(planDate);
    db.prepare("DELETE FROM daily_plans WHERE plan_date = ?").run(planDate);
    generateDailyPlans(db, planDate);

    const modes = db
      .prepare(
        `SELECT dp.device_id, dp.daily_mode, d.operator_id FROM daily_plans dp
         JOIN devices d ON d.id = dp.device_id WHERE dp.plan_date = ?`
      )
      .all(planDate) as Array<{ device_id: string; daily_mode: string; operator_id: string | null }>;

    const byOperator = new Map<string, Set<string>>();
    for (const m of modes) {
      const op = m.operator_id ?? "none";
      const set = byOperator.get(op) ?? new Set();
      set.add(m.daily_mode);
      byOperator.set(op, set);
    }
    byOperator.forEach((set, op) => {
      if (op !== "none") expect(set.size).toBeGreaterThanOrEqual(1);
    });
    const op1Modes = byOperator.get(
      (modes.find((m) => m.operator_id)?.operator_id ?? "")
    );
    if (op1Modes) expect(op1Modes.size).toBe(4);
  });
});
