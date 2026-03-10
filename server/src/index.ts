import express from "express";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getDb, initDb } from "./db/index.js";
import { devicesRouter } from "./routes/devices.js";
import { planRouter } from "./routes/plan.js";
import { logsRouter } from "./routes/logs.js";
import { adminRouter } from "./routes/admin.js";
import { adminDevicesRouter } from "./routes/admin-devices.js";
import { adminAccountsRouter } from "./routes/admin-accounts.js";
import { postQueueRouter } from "./routes/post-queue.js";
import { generateDailyPlans } from "./services/planGenerator.js";
import { seedPersonas } from "./seeds/personas.js";
import { v4 as uuidv4 } from "uuid";
import { mkdirSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

const dataDir = join(__dirname, "../data");
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
try {
  initDb();
  // Ensure default personas are present
  seedPersonas(getDb());
} catch (e) {
  console.warn("DB init:", (e as Error).message);
}

app.use("/device", devicesRouter);
app.use("/plan", planRouter);
app.use("/logs", logsRouter);
app.use("/admin", adminRouter);
app.use("/admin/devices", adminDevicesRouter);
app.use("/admin/accounts", adminAccountsRouter);
app.use("/post-queue", postQueueRouter);

app.post("/admin/generate-plans", (req, res) => {
  const date = (req.body?.date as string) || new Date().toISOString().slice(0, 10);
  const db = getDb();
  const existing = db.prepare("SELECT id FROM daily_plans WHERE plan_date = ?").get(date);
  if (existing) {
    res.status(400).json({ error: "Plans already exist for this date", date });
    return;
  }
  generateDailyPlans(db, date);
  res.json({ ok: true, date });
});

app.get("/admin/personas", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM personas ORDER BY name").all() as Array<Record<string, unknown>>;
  res.json({ personas: rows });
});

app.get("/admin/operators", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM operators ORDER BY name").all() as Array<Record<string, unknown>>;
  res.json({ operators: rows });
});

app.post("/admin/operators", (req, res) => {
  const { name, coverage_weekday, coverage_weekend } = req.body as {
    name?: string;
    coverage_weekday?: number;
    coverage_weekend?: number;
  };
  if (!name) {
    res.status(400).json({ error: "name required" });
    return;
  }
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    "INSERT INTO operators (id, name, coverage_weekday, coverage_weekend) VALUES (?, ?, ?, ?)"
  ).run(id, name, coverage_weekday ?? 1, coverage_weekend ?? 0);
  const row = db.prepare("SELECT * FROM operators WHERE id = ?").get(id) as Record<string, unknown>;
  res.status(201).json(row);
});

const publicPath = join(__dirname, "../public");
app.use(express.static(publicPath));
app.get("/admin-ui", (_req, res) => {
  res.sendFile(join(publicPath, "admin", "index.html"));
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`DOS server at http://localhost:${PORT}`);
});
