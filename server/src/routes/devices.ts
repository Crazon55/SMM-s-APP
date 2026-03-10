import { Router } from "express";
import { getDb } from "../db/index.js";
import { hashDeviceToken } from "../middleware/auth.js";
import { v4 as uuidv4 } from "uuid";

export const devicesRouter = Router();

// Enroll: validate token, return device identity and server time (for clock sync)
// Body: { token: string } or token in header
devicesRouter.post("/enroll", (req, res) => {
  const token =
    (req.body?.token as string) || req.header("x-device-token");
  if (!token) {
    res.status(400).json({ error: "Token required" });
    return;
  }

  const db = getDb();
  const tokenHash = hashDeviceToken(token);
  const row = db
    .prepare(
      `SELECT d.id, d.name, d.persona_id, p.name as persona_name,
              p.active_window_start, p.active_window_end
       FROM devices d
       JOIN personas p ON d.persona_id = p.id
       WHERE d.token_hash = ? AND d.status = 'active'`
    )
    .get(tokenHash) as
    | {
        id: string;
        name: string;
        persona_id: string;
        persona_name: string;
        active_window_start: string;
        active_window_end: string;
      }
    | undefined;

  if (!row) {
    res.status(401).json({ error: "Invalid or inactive device token" });
    return;
  }

  res.json({
    device_id: row.id,
    device_name: row.name,
    persona_id: row.persona_id,
    persona_name: row.persona_name,
    active_window: {
      start: row.active_window_start,
      end: row.active_window_end,
    },
    server_time_iso: new Date().toISOString(),
  });
});
