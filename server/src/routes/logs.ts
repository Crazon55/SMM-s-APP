import { Router } from "express";
import { getDb } from "../db/index.js";
import { requireDeviceAuth } from "../middleware/auth.js";
import { v4 as uuidv4 } from "uuid";
import type { SessionLogPayload, PostLogPayload } from "../types/index.js";

export const logsRouter = Router();

logsRouter.post("/session", requireDeviceAuth, (req, res) => {
  const deviceId = (req as unknown as { deviceId: string }).deviceId;
  const body = req.body as SessionLogPayload;
  if (
    !body.session_id ||
    !body.planned_start ||
    typeof body.planned_duration_min !== "number" ||
    !body.status
  ) {
    res.status(400).json({ error: "session_id, planned_start, planned_duration_min, status required" });
    return;
  }

  const db = getDb();
  const idempotencyKey =
    body.idempotency_key || `session-${deviceId}-${body.session_id}-${Date.now()}`;

  const existing = db.prepare("SELECT id FROM session_logs WHERE idempotency_key = ?").get(idempotencyKey);
  if (existing) {
    res.status(200).json({ id: (existing as { id: string }).id, duplicate: true });
    return;
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO session_logs (id, device_id, session_id, planned_start, planned_duration_min, actual_start, actual_end, status, server_time_iso, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    deviceId,
    body.session_id,
    body.planned_start,
    body.planned_duration_min,
    body.actual_start ?? null,
    body.actual_end ?? null,
    body.status,
    new Date().toISOString(),
    idempotencyKey
  );

  res.status(201).json({ id });
});

logsRouter.post("/post", requireDeviceAuth, (req, res) => {
  const deviceId = (req as unknown as { deviceId: string }).deviceId;
  const body = req.body as PostLogPayload;
  if (!body.account_id || !body.actual_time || !body.status) {
    res.status(400).json({ error: "account_id, actual_time, status required" });
    return;
  }

  const db = getDb();
  const idempotencyKey =
    body.idempotency_key ||
    `post-${deviceId}-${body.account_id}-${body.actual_time}-${Date.now()}`;

  const existing = db.prepare("SELECT id FROM post_logs WHERE idempotency_key = ?").get(idempotencyKey);
  if (existing) {
    res.status(200).json({ id: (existing as { id: string }).id, duplicate: true });
    return;
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO post_logs (id, device_id, account_id, planned_time_start, planned_time_end, actual_time, status, server_time_iso, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    deviceId,
    body.account_id,
    body.planned_time_start ?? null,
    body.planned_time_end ?? null,
    body.actual_time,
    body.status,
    new Date().toISOString(),
    idempotencyKey
  );

  res.status(201).json({ id });
});
