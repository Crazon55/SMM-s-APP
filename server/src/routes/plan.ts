import { Router } from "express";
import { getDb } from "../db/index.js";
import { requireDeviceAuth } from "../middleware/auth.js";

export const planRouter = Router();

planRouter.get("/today", requireDeviceAuth, (req, res) => {
  const deviceId = (req as unknown as { deviceId: string }).deviceId;
  const db = getDb();

  const today = new Date().toISOString().slice(0, 10);

  const planRow = db
    .prepare(
      `SELECT dp.id, dp.plan_date, dp.daily_mode, dp.session_count,
              p.name as persona_name, p.active_window_start, p.active_window_end
       FROM daily_plans dp
       JOIN devices d ON d.id = dp.device_id
       JOIN personas p ON d.persona_id = p.id
       WHERE dp.device_id = ? AND dp.plan_date = ?`
    )
    .get(deviceId, today) as
    | {
        id: string;
        plan_date: string;
        daily_mode: string;
        session_count: number;
        persona_name: string;
        active_window_start: string;
        active_window_end: string;
      }
    | undefined;

  if (!planRow) {
    res.status(404).json({
      error: "No plan for today",
      server_time_iso: new Date().toISOString(),
    });
    return;
  }

  const sessions = db
    .prepare(
      `SELECT id, planned_start, planned_duration_min, sort_order
       FROM planned_sessions WHERE daily_plan_id = ? ORDER BY sort_order, planned_start`
    )
    .all(planRow.id) as Array<{
    id: string;
    planned_start: string;
    planned_duration_min: number;
    sort_order: number;
  }>;

  const focusRows = db
    .prepare(
      `SELECT psf.session_id, psf.account_id, psf.role, a.display_name
       FROM planned_session_focus psf
       JOIN accounts a ON a.id = psf.account_id
       WHERE psf.session_id IN (
         SELECT id FROM planned_sessions WHERE daily_plan_id = ?
       )`
    )
    .all(planRow.id) as Array<{
    session_id: string;
    account_id: string;
    role: string;
    display_name: string | null;
  }>;

  const focusBySession = new Map<
    string,
    { dominant: Array<{ account_id: string; account_display_name: string }>; secondary: Array<{ account_id: string; account_display_name: string }> }
  >();

  for (const row of focusRows) {
    const bucket = focusBySession.get(row.session_id) ?? {
      dominant: [],
      secondary: [],
    };
    const entry = {
      account_id: row.account_id,
      account_display_name: row.display_name || row.account_id,
    };
    if (row.role === "dominant") {
      bucket.dominant.push(entry);
    } else {
      bucket.secondary.push(entry);
    }
    focusBySession.set(row.session_id, bucket);
  }

  const posts = db
    .prepare(
      `SELECT pp.id, pp.account_id, pp.planned_time_window_start, pp.planned_time_window_end,
              pp.variance_min, pp.variance_max, a.display_name as account_display_name
       FROM planned_posts pp
       LEFT JOIN accounts a ON pp.account_id = a.id
       WHERE pp.daily_plan_id = ? ORDER BY pp.planned_time_window_start`
    )
    .all(planRow.id) as Array<{
    id: string;
    account_id: string;
    planned_time_window_start: string;
    planned_time_window_end: string;
    variance_min: number;
    variance_max: number;
    account_display_name: string | null;
  }>;

  res.json({
    plan_id: planRow.id,
    plan_date: planRow.plan_date,
    persona_name: planRow.persona_name,
    active_window: {
      start: planRow.active_window_start,
      end: planRow.active_window_end,
    },
    daily_mode: planRow.daily_mode,
    session_count: planRow.session_count,
    sessions: sessions.map((s) => {
      const focus = focusBySession.get(s.id) ?? { dominant: [], secondary: [] };
      return {
        id: s.id,
        planned_start: s.planned_start,
        planned_duration_min: s.planned_duration_min,
        sort_order: s.sort_order,
        dominant_accounts: focus.dominant,
        secondary_accounts: focus.secondary,
      };
    }),
    posting_tasks: posts.map((p) => ({
      id: p.id,
      account_id: p.account_id,
      account_display_name: p.account_display_name || p.account_id,
      planned_time_window_start: p.planned_time_window_start,
      planned_time_window_end: p.planned_time_window_end,
      variance_min: p.variance_min,
      variance_max: p.variance_max,
    })),
    server_time_iso: new Date().toISOString(),
  });
});
