import { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { getDb } from "../db/index.js";

const DEVICE_TOKEN_HEADER = "x-device-token";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function requireDeviceAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = req.header(DEVICE_TOKEN_HEADER);
  if (!token) {
    res.status(401).json({ error: "Missing device token" });
    return;
  }

  const db = getDb();
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT id, name, persona_id, operator_id, status FROM devices 
       WHERE token_hash = ? AND status = 'active'`
    )
    .get(tokenHash) as
    | { id: string; name: string; persona_id: string; operator_id: string | null; status: string }
    | undefined;

  if (!row) {
    res.status(401).json({ error: "Invalid or inactive device token" });
    return;
  }

  (req as Request & { deviceId: string; deviceName: string; operatorId: string | null }).deviceId = row.id;
  (req as Request & { deviceId: string; deviceName: string; operatorId: string | null }).deviceName = row.name;
  (req as Request & { deviceId: string; deviceName: string; operatorId: string | null }).operatorId = row.operator_id;
  next();
}

export function hashDeviceToken(token: string): string {
  return hashToken(token);
}
