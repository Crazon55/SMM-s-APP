import { Router } from "express";
import { getDb } from "../db/index.js";
import { hashDeviceToken } from "../middleware/auth.js";
import { v4 as uuidv4 } from "uuid";

export const adminDevicesRouter = Router();

adminDevicesRouter.get("/", (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT d.id, d.name, d.device_unique_id, d.persona_id, d.operator_id, d.status,
              d.token_hash IS NOT NULL as has_token,
              p.name as persona_name, o.name as operator_name
       FROM devices d
       JOIN personas p ON d.persona_id = p.id
       LEFT JOIN operators o ON d.operator_id = o.id
       ORDER BY d.name`
    )
    .all() as Array<Record<string, unknown>>;
  res.json({ devices: rows });
});

adminDevicesRouter.post("/", (req, res) => {
  const { name, persona_id, operator_id } = req.body as {
    name?: string;
    persona_id?: string;
    operator_id?: string;
  };
  if (!name || !persona_id) {
    res.status(400).json({ error: "name and persona_id required" });
    return;
  }

  const db = getDb();
  const id = uuidv4();
  const deviceUniqueId = `dos-${id.slice(0, 8)}`;
  db.prepare(
    `INSERT INTO devices (id, name, device_unique_id, persona_id, operator_id, status) VALUES (?, ?, ?, ?, ?, 'active')`
  ).run(id, name, deviceUniqueId, persona_id, operator_id ?? null);

  const row = db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as Record<string, unknown>;
  res.status(201).json(row);
});

adminDevicesRouter.patch("/:id", (req, res) => {
  const { id } = req.params;
  const { name, persona_id, operator_id, status } = req.body as {
    name?: string;
    persona_id?: string;
    operator_id?: string;
    status?: string;
  };

  const db = getDb();
  const existing = db.prepare("SELECT id FROM devices WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  if (name !== undefined) {
    updates.push("name = ?");
    values.push(name);
  }
  if (persona_id !== undefined) {
    updates.push("persona_id = ?");
    values.push(persona_id);
  }
  if (operator_id !== undefined) {
    updates.push("operator_id = ?");
    values.push(operator_id || null);
  }
  if (status !== undefined && ["active", "paused", "retired"].includes(status)) {
    updates.push("status = ?");
    values.push(status);
  }
  updates.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE devices SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  const row = db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as Record<string, unknown>;
  res.json(row);
});

adminDevicesRouter.post("/:id/provision-token", (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const device = db.prepare("SELECT id FROM devices WHERE id = ?").get(id) as { id: string } | undefined;
  if (!device) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  const token = uuidv4().replace(/-/g, "");
  const tokenHash = hashDeviceToken(token);
  db.prepare("UPDATE devices SET token_hash = ?, updated_at = datetime('now') WHERE id = ?").run(tokenHash, id);

  res.json({ device_id: id, token, message: "Store this token securely; it will not be shown again." });
});
