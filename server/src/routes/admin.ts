import { Router } from "express";
import { getDb } from "../db/index.js";
import { generateDailyPlans } from "../services/planGenerator.js";

export const adminRouter = Router();

adminRouter.get("/today", (_req, res) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const plans = db
    .prepare(
      `SELECT dp.id, dp.device_id, dp.plan_date, dp.daily_mode, dp.session_count,
              d.name as device_name, p.name as persona_name, o.name as operator_name
       FROM daily_plans dp
       JOIN devices d ON d.id = dp.device_id
       JOIN personas p ON d.persona_id = p.id
       LEFT JOIN operators o ON d.operator_id = o.id
       WHERE dp.plan_date = ?
       ORDER BY d.name`
    )
    .all(today) as Array<{
    id: string;
    device_id: string;
    plan_date: string;
    daily_mode: string;
    session_count: number;
    device_name: string;
    persona_name: string;
    operator_name: string | null;
  }>;

  const sessions = db
    .prepare(
      `SELECT ps.id, ps.device_id, ps.planned_start, ps.planned_duration_min, ps.sort_order
       FROM planned_sessions ps
       JOIN daily_plans dp ON dp.id = ps.daily_plan_id
       WHERE dp.plan_date = ?
       ORDER BY ps.device_id, ps.sort_order`
    )
    .all(today) as Array<{
    id: string;
    device_id: string;
    planned_start: string;
    planned_duration_min: number;
    sort_order: number;
  }>;

  const sessionLogs = db
    .prepare(
      `SELECT sl.device_id, sl.session_id, sl.status, sl.actual_start, sl.actual_end, sl.created_at
       FROM session_logs sl
       JOIN planned_sessions ps ON ps.id = sl.session_id
       JOIN daily_plans dp ON dp.id = ps.daily_plan_id
       WHERE dp.plan_date = ?`
    )
    .all(today) as Array<{
    device_id: string;
    session_id: string;
    status: string;
    actual_start: string | null;
    actual_end: string | null;
    created_at: string;
  }>;

  const postLogs = db
    .prepare(
      `SELECT pl.device_id, pl.account_id, pl.status, pl.actual_time
       FROM post_logs pl
       WHERE date(pl.created_at) = ?`
    )
    .all(today) as Array<{
    device_id: string;
    account_id: string;
    status: string;
    actual_time: string | null;
  }>;

  // Build a quick lookup of latest log per session_id
  const latestLogBySessionId = new Map<
    string,
    { status: string; actual_start: string | null; actual_end: string | null }
  >();
  for (const log of sessionLogs) {
    const existing = latestLogBySessionId.get(log.session_id);
    if (!existing || log.created_at > (existing as unknown as { created_at: string }).created_at) {
      // Store status + times, and keep created_at only for comparison via cast
      latestLogBySessionId.set(
        log.session_id,
        {
          status: log.status,
          actual_start: log.actual_start,
          actual_end: log.actual_end,
        } as any
      );
      (latestLogBySessionId.get(log.session_id) as any).created_at = log.created_at;
    }
  }

  res.json({
    plan_date: today,
    devices: plans.map((p) => ({
      plan_id: p.id,
      device_id: p.device_id,
      device_name: p.device_name,
      persona_name: p.persona_name,
      operator_name: p.operator_name,
      daily_mode: p.daily_mode,
      session_count: p.session_count,
      sessions: sessions
        .filter((s) => s.device_id === p.device_id)
        .map((s) => {
          const log = latestLogBySessionId.get(s.id) as
            | { status: string; actual_start: string | null; actual_end: string | null; created_at?: string }
            | undefined;
          return {
            id: s.id,
            planned_start: s.planned_start,
            planned_duration_min: s.planned_duration_min,
            sort_order: s.sort_order,
            status: log?.status ?? "pending",
            actual_start: log?.actual_start ?? null,
            actual_end: log?.actual_end ?? null,
          };
        }),
      session_logs: sessionLogs.filter((s) => s.device_id === p.device_id),
      post_logs: postLogs.filter((l) => l.device_id === p.device_id),
    })),
  });
});

// Force regenerate plans for a given date (default: today).
// This clears existing daily_plans + planned sessions/posts and any logs for that date,
// then calls the plan generator again so newly added devices/operators get a plan.
adminRouter.post("/regenerate-plans", (req, res) => {
  const db = getDb();
  const date =
    (req.body?.date as string | undefined) || new Date().toISOString().slice(0, 10);

  db.transaction(() => {
    // Delete logs for this date
    db.prepare("DELETE FROM session_logs WHERE date(created_at) = ?").run(date);
    db.prepare("DELETE FROM post_logs WHERE date(created_at) = ?").run(date);

    // Delete planned posts and sessions linked to plans for this date
    const planIds = db
      .prepare("SELECT id FROM daily_plans WHERE plan_date = ?")
      .all(date) as Array<{ id: string }>;

    const deleteFocus = db.prepare(
      `DELETE FROM planned_session_focus WHERE session_id IN (
         SELECT id FROM planned_sessions WHERE daily_plan_id = ?
       )`
    );
    const deleteSessions = db.prepare(
      "DELETE FROM planned_sessions WHERE daily_plan_id = ?"
    );
    const deletePosts = db.prepare(
      "DELETE FROM planned_posts WHERE daily_plan_id = ?"
    );

    for (const p of planIds) {
      deleteFocus.run(p.id);
      deleteSessions.run(p.id);
      deletePosts.run(p.id);
    }

    db.prepare("DELETE FROM daily_plans WHERE plan_date = ?").run(date);
  })();

  // Re-generate fresh plans for this date
  generateDailyPlans(db, date);
  res.json({ ok: true, date });
});

adminRouter.get("/logs", (req, res) => {
  const db = getDb();
  const { date, device_id, operator_id } = req.query;

  let sessionWhere = "1=1";
  let postWhere = "1=1";
  const params: string[] = [];

  if (date && typeof date === "string") {
    sessionWhere += " AND date(sl.created_at) = ?";
    postWhere += " AND date(pl.created_at) = ?";
    params.push(date);
  }
  if (device_id && typeof device_id === "string") {
    sessionWhere += " AND sl.device_id = ?";
    postWhere += " AND pl.device_id = ?";
    params.push(device_id);
  }
  if (operator_id && typeof operator_id === "string") {
    sessionWhere += " AND sl.device_id IN (SELECT id FROM devices WHERE operator_id = ?)";
    postWhere += " AND pl.device_id IN (SELECT id FROM devices WHERE operator_id = ?)";
    params.push(operator_id);
  }

  const sessionLogs = db
    .prepare(
      `SELECT sl.*, d.name as device_name
       FROM session_logs sl
       JOIN devices d ON d.id = sl.device_id
       WHERE ${sessionWhere}
       ORDER BY sl.created_at DESC
       LIMIT 500`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const postLogs = db
    .prepare(
      `SELECT pl.*, d.name as device_name, a.display_name as account_display_name
       FROM post_logs pl
       JOIN devices d ON d.id = pl.device_id
       LEFT JOIN accounts a ON a.id = pl.account_id
       WHERE ${postWhere}
       ORDER BY pl.created_at DESC
       LIMIT 500`
    )
    .all(...params) as Array<Record<string, unknown>>;

  res.json({ session_logs: sessionLogs, post_logs: postLogs });
});

// Mark missed sessions/posts at end of day for a given date
adminRouter.post("/close-day", (req, res) => {
  const db = getDb();
  const date =
    (req.body?.date as string | undefined) || new Date().toISOString().slice(0, 10);

  db.transaction(() => {
    // Auto-miss sessions without any log
    const plannedSessions = db
      .prepare(
        `SELECT ps.id as session_id, ps.device_id, ps.planned_start, ps.planned_duration_min
         FROM planned_sessions ps
         JOIN daily_plans dp ON dp.id = ps.daily_plan_id
         WHERE dp.plan_date = ?`
      )
      .all(date) as Array<{
      session_id: string;
      device_id: string;
      planned_start: string;
      planned_duration_min: number;
    }>;

    const hasSessionLogStmt = db.prepare(
      "SELECT 1 FROM session_logs WHERE session_id = ? LIMIT 1"
    );
    const insertMissedSession = db.prepare(
      `INSERT INTO session_logs
         (id, device_id, session_id, planned_start, planned_duration_min, actual_start, actual_end, status, server_time_iso, idempotency_key)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, 'missed', ?, ?)`
    );

    for (const s of plannedSessions) {
      const exists = hasSessionLogStmt.get(s.session_id) as { 1: number } | undefined;
      if (!exists) {
        const id = require("uuid").v4();
        insertMissedSession.run(
          id,
          s.device_id,
          s.session_id,
          s.planned_start,
          s.planned_duration_min,
          new Date().toISOString(),
          `auto-missed-session-${s.session_id}-${date}`
        );
      }
    }

    // Auto-miss posts without any log
    const plannedPosts = db
      .prepare(
        `SELECT pp.id, pp.device_id, pp.account_id, pp.planned_time_window_start, pp.planned_time_window_end
         FROM planned_posts pp
         JOIN daily_plans dp ON dp.id = pp.daily_plan_id
         WHERE dp.plan_date = ?`
      )
      .all(date) as Array<{
      id: string;
      device_id: string;
      account_id: string;
      planned_time_window_start: string;
      planned_time_window_end: string;
    }>;

    const hasPostLogStmt = db.prepare(
      `SELECT 1 FROM post_logs
         WHERE device_id = ? AND account_id = ?
           AND date(created_at) = ?
         LIMIT 1`
    );
    const insertMissedPost = db.prepare(
      `INSERT INTO post_logs
         (id, device_id, account_id, planned_time_start, planned_time_end, actual_time, status, server_time_iso, idempotency_key)
       VALUES (?, ?, ?, ?, ?, NULL, 'missed', ?, ?)`
    );

    for (const p of plannedPosts) {
      const exists = hasPostLogStmt.get(p.device_id, p.account_id, date) as
        | { 1: number }
        | undefined;
      if (!exists) {
        const id = require("uuid").v4();
        insertMissedPost.run(
          id,
          p.device_id,
          p.account_id,
          p.planned_time_window_start,
          p.planned_time_window_end,
          new Date().toISOString(),
          `auto-missed-post-${p.device_id}-${p.account_id}-${date}`
        );
      }
    }
  })();

  res.json({ ok: true, date });
});

adminRouter.get("/devices", (_req, res) => {
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

adminRouter.get("/settings", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM system_settings").all() as Array<{ key: string; value: string }>;
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

adminRouter.post("/settings", (req, res) => {
  const db = getDb();
  const body = req.body as Record<string, string>;
  const update = db.prepare(
    "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
  );
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") update.run(key, value);
  }
  res.json({ ok: true });
});
