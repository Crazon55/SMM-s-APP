import { Router } from "express";
import { getDb } from "../db/index.js";
import { v4 as uuidv4 } from "uuid";

export const adminAccountsRouter = Router();

adminAccountsRouter.get("/", (req, res) => {
  const db = getDb();
  const device_id = req.query.device_id as string | undefined;
  let rows: Array<Record<string, unknown>>;
  if (device_id) {
    rows = db.prepare("SELECT * FROM accounts WHERE device_id = ? ORDER BY display_name").all(device_id) as Array<Record<string, unknown>>;
  } else {
    rows = db.prepare("SELECT a.*, d.name as device_name FROM accounts a JOIN devices d ON a.device_id = d.id ORDER BY d.name, a.display_name").all() as Array<Record<string, unknown>>;
  }
  res.json({ accounts: rows });
});

adminAccountsRouter.post("/", (req, res) => {
  const { device_id, display_name, account_identifier } = req.body as {
    device_id?: string;
    display_name?: string;
    account_identifier?: string;
  };
  if (!device_id) {
    res.status(400).json({ error: "device_id required" });
    return;
  }

  const db = getDb();
  const id = uuidv4();
  db.prepare(
    "INSERT INTO accounts (id, device_id, display_name, account_identifier) VALUES (?, ?, ?, ?)"
  ).run(id, device_id, display_name ?? null, account_identifier ?? null);

  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Record<string, unknown>;
  res.status(201).json(row);
});

adminAccountsRouter.patch("/:id", (req, res) => {
  const { id } = req.params;
  const { device_id, display_name, account_identifier } = req.body as {
    device_id?: string;
    display_name?: string;
    account_identifier?: string;
  };

  const db = getDb();
  const existing = db.prepare("SELECT id FROM accounts WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  if (device_id !== undefined) {
    updates.push("device_id = ?");
    values.push(device_id);
  }
  if (display_name !== undefined) {
    updates.push("display_name = ?");
    values.push(display_name);
  }
  if (account_identifier !== undefined) {
    updates.push("account_identifier = ?");
    values.push(account_identifier);
  }
  updates.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE accounts SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Record<string, unknown>;
  res.json(row);
});

adminAccountsRouter.delete("/:id", (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const r = db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  if (r.changes === 0) res.status(404).json({ error: "Account not found" });
  else res.json({ ok: true });
});
