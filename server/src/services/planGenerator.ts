import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type { DailyMode } from "../types/index.js";

const MODES: DailyMode[] = ["light", "normal", "heavy", "post_only"];

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function getSettings(db: Database.Database): Record<string, number> {
  const rows = db.prepare("SELECT key, value FROM system_settings").all() as Array<{ key: string; value: string }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key] = parseInt(r.value, 10) || 0;
  return out;
}

export function generateDailyPlans(db: Database.Database, planDate: string): void {
  const settings = getSettings(db);
  const sessionBufferMin = settings.session_proximity_buffer_min ?? 5;
  const sessionBufferMax = settings.session_proximity_buffer_max ?? 10;
  const postBufferMin = settings.post_proximity_buffer_min ?? 2;
  const postBufferMax = settings.post_proximity_buffer_max ?? 3;
  const sameDevicePostGap = settings.same_device_post_gap_min ?? 10;
  const postVarianceMin = settings.post_variance_min ?? 5;
  const postVarianceMax = settings.post_variance_max ?? 15;

  const devices = db
    .prepare(
      `SELECT d.id, d.persona_id, d.operator_id, p.session_count_min, p.session_count_max,
              p.session_duration_min, p.session_duration_max, p.active_window_start, p.active_window_end,
              p.peak_bias_windows
       FROM devices d
       JOIN personas p ON d.persona_id = p.id
       WHERE d.status = 'active'`
    )
    .all() as Array<{
    id: string;
    persona_id: string;
    operator_id: string | null;
    session_count_min: number;
    session_count_max: number;
    session_duration_min: number;
    session_duration_max: number;
    active_window_start: string;
    active_window_end: string;
    peak_bias_windows: string | null;
  }>;

  if (!devices.length) return;

  const dayOfWeek = new Date(planDate).getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const operators = new Map<string, string[]>();
  for (const d of devices) {
    if (d.operator_id) {
      const list = operators.get(d.operator_id) ?? [];
      list.push(d.id);
      operators.set(d.operator_id, list);
    }
  }

  const assignedModes = new Map<string, DailyMode>();
  const usedModeByOperator = new Map<string, Set<DailyMode>>();

  function assignMode(deviceId: string, operatorId: string | null): DailyMode {
    const available = MODES.filter((m) => {
      if (!operatorId) return true;
      const used = usedModeByOperator.get(operatorId);
      return !used?.has(m);
    });
    const mode = available[Math.floor(Math.random() * available.length)] ?? "normal";
    assignedModes.set(deviceId, mode);
    if (operatorId) {
      const set = usedModeByOperator.get(operatorId) ?? new Set();
      set.add(mode);
      usedModeByOperator.set(operatorId, set);
    }
    return mode;
  }

  const allSessionStarts: number[] = [];
  // Track intervals per-operator so we can avoid overlapping sessions
  // for the same human across multiple devices.
  const operatorSessions = new Map<string, Array<{ start: number; end: number }>>();
  const sessionBuffer = sessionBufferMin + Math.floor(Math.random() * (sessionBufferMax - sessionBufferMin + 1));

  const insertPlan = db.prepare(
    `INSERT INTO daily_plans (id, device_id, plan_date, daily_mode, session_count) VALUES (?, ?, ?, ?, ?)`
  );
  const insertSession = db.prepare(
    `INSERT INTO planned_sessions (id, daily_plan_id, device_id, planned_start, planned_duration_min, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertFocus = db.prepare(
    `INSERT INTO planned_session_focus (id, session_id, account_id, role) VALUES (?, ?, ?, ?)`
  );

  db.transaction(() => {
    // Preload accounts per device for focus assignment
    const accountRows = db
      .prepare(
        `SELECT id, device_id, display_name
         FROM accounts`
      )
      .all() as Array<{ id: string; device_id: string; display_name: string | null }>;

    const accountsByDevice = new Map<string, Array<{ id: string; display_name: string | null }>>();
    for (const row of accountRows) {
      const list = accountsByDevice.get(row.device_id) ?? [];
      list.push({ id: row.id, display_name: row.display_name });
      accountsByDevice.set(row.device_id, list);
    }

    // Preload which accounts have posts scheduled/pending in queue for this date
    const queueRows = db
      .prepare(
        `SELECT device_id, account_id
         FROM post_queue
         WHERE planned_date = ? AND status = 'pending' AND account_id IS NOT NULL`
      )
      .all(planDate) as Array<{ device_id: string; account_id: string }>;

    const queueAccountsByDevice = new Map<string, Set<string>>();
    for (const row of queueRows) {
      const set = queueAccountsByDevice.get(row.device_id) ?? new Set<string>();
      set.add(row.account_id);
      queueAccountsByDevice.set(row.device_id, set);
    }

    for (const dev of devices) {
      const mode = assignMode(dev.id, dev.operator_id);
      let sessionCount =
        dev.session_count_min +
        Math.floor(Math.random() * (dev.session_count_max - dev.session_count_min + 1));
      sessionCount = Math.max(3, Math.min(6, sessionCount));

      const windowStart = parseTime(dev.active_window_start);
      // Stagger shutdown: trim the active window end differently per device
      let windowEnd = parseTime(dev.active_window_end);
      const trimMinutes = Math.floor(Math.random() * 45); // up to 45 minutes earlier
      windowEnd = Math.max(windowStart + 60, windowEnd - trimMinutes);
      const windowLen = windowEnd - windowStart;
      if (windowLen <= 0) continue;

      const planId = uuidv4();
      insertPlan.run(planId, dev.id, planDate, mode, sessionCount);

      let peakBias: Array<{ start: number; end: number }> = [];
      if (dev.peak_bias_windows) {
        try {
          const arr = JSON.parse(dev.peak_bias_windows) as Array<{ start: string; end: string }>;
          peakBias = arr.map((x) => ({ start: parseTime(x.start), end: parseTime(x.end) }));
        } catch {
          /* ignore */
        }
      }

      const sessionDurations: number[] = [];
      for (let i = 0; i < sessionCount; i++) {
        const dur =
          dev.session_duration_min +
          Math.floor(Math.random() * (dev.session_duration_max - dev.session_duration_min + 1));
        sessionDurations.push(dur);
      }

      const usedStarts = new Set<number>();
      const sessionIds: string[] = [];
      for (let i = 0; i < sessionCount; i++) {
        let startMinutes: number;
        let attempts = 0;
        do {
          // Pick a base window for this session: either one of the persona's
          // usage windows (peakBias) or the full active window as a fallback.
          let baseWindowStart = windowStart;
          let baseWindowEnd = windowEnd;
          if (peakBias.length) {
            const w = peakBias[Math.floor(Math.random() * peakBias.length)];
            baseWindowStart = Math.max(windowStart, w.start);
            baseWindowEnd = Math.min(windowEnd, w.end);
          }
          const localLen = Math.max(30, baseWindowEnd - baseWindowStart);

          let base = baseWindowStart + Math.floor(Math.random() * (localLen - 15));
          const jitter = Math.floor((Math.random() - 0.5) * 25); // up to ~±12 min
          startMinutes = Math.max(windowStart, Math.min(windowEnd - 15, base + jitter));

          const duration = sessionDurations[i] ?? dev.session_duration_min;
          const endMinutes = startMinutes + duration;

          const tooCloseGlobal = allSessionStarts.some((s) => Math.abs(s - startMinutes) < sessionBuffer);

          // Avoid overlapping blocks for the same operator where possible.
          let overlapsOperator = false;
          if (dev.operator_id) {
            const opSessions = operatorSessions.get(dev.operator_id) ?? [];
            overlapsOperator = opSessions.some((sess) => {
              // overlap if intervals intersect with a small buffer
              return !(
                endMinutes + sessionBuffer <= sess.start ||
                startMinutes >= sess.end + sessionBuffer
              );
            });
          }

          if (!tooCloseGlobal && !usedStarts.has(startMinutes) && !overlapsOperator) break;
          attempts++;
          if (attempts > 200) {
            startMinutes =
              windowStart +
              Math.floor((windowLen * (i + 1)) / (sessionCount + 1)) +
              i * sessionBuffer;
            break;
          }
        } while (true);

        usedStarts.add(startMinutes);
        allSessionStarts.push(startMinutes);
        const duration = sessionDurations[i] ?? dev.session_duration_min;
        const endMinutes = startMinutes + duration;
        if (dev.operator_id) {
          const list = operatorSessions.get(dev.operator_id) ?? [];
          list.push({ start: startMinutes, end: endMinutes });
          operatorSessions.set(dev.operator_id, list);
        }
        const startStr = formatTime(startMinutes);
        const sessionId = uuidv4();
        sessionIds.push(sessionId);
        insertSession.run(sessionId, planId, dev.id, startStr, duration, i);
      }

      // Assign per-session dominant / secondary account focus for this device
      const deviceAccounts = accountsByDevice.get(dev.id);
      if (deviceAccounts && deviceAccounts.length) {
        // Shuffle accounts to avoid fixed order bias
        const shuffled = [...deviceAccounts];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const startOffset = Math.floor(Math.random() * shuffled.length);

        // Accounts that must post today on this device
        const mustPostAccounts = Array.from(queueAccountsByDevice.get(dev.id) ?? new Set<string>());

        // Map from session index -> dominant account id (pre-assign for must-post accounts)
        const dominantByIndex = new Map<number, string>();
        mustPostAccounts.forEach((accId, i) => {
          if (!sessionIds.length) return;
          const idx = i % sessionIds.length;
          dominantByIndex.set(idx, accId);
        });

        sessionIds.forEach((sessionId, idx) => {
          // Determine dominant account for this session
          let dominantId = dominantByIndex.get(idx);
          if (!dominantId) {
            const dominant = shuffled[(startOffset + idx) % shuffled.length];
            dominantId = dominant.id;
          }
          insertFocus.run(uuidv4(), sessionId, dominantId, "dominant");

          // Optionally one secondary if more than one account
          if (shuffled.length > 1) {
            const secondaryCandidates = shuffled.filter((a) => a.id !== dominantId);
            if (secondaryCandidates.length > 0) {
              const secondary =
                secondaryCandidates[
                  Math.floor(Math.random() * secondaryCandidates.length)
                ];
              insertFocus.run(uuidv4(), sessionId, secondary.id, "secondary");
            }
          }
        });
      }
    }
  })();

  schedulePostingTasks(db, planDate, {
    postBufferMin,
    postBufferMax,
    sameDevicePostGap,
    postVarianceMin,
    postVarianceMax,
  });
}

function schedulePostingTasks(
  db: Database.Database,
  planDate: string,
  opts: {
    postBufferMin: number;
    postBufferMax: number;
    sameDevicePostGap: number;
    postVarianceMin: number;
    postVarianceMax: number;
  }
): void {
  const plans = db.prepare("SELECT id, device_id FROM daily_plans WHERE plan_date = ?").all(planDate) as Array<{
    id: string;
    device_id: string;
  }>;

  const queue = db
    .prepare(
      `SELECT pq.id, pq.device_id, pq.account_id, pq.planned_time_start, pq.planned_time_end
       FROM post_queue pq
       WHERE pq.planned_date = ? AND pq.status = 'pending'
       ORDER BY pq.device_id, pq.planned_time_start`
    )
    .all(planDate) as Array<{
    id: string;
    device_id: string;
    account_id: string | null;
    planned_time_start: string | null;
    planned_time_end: string | null;
  }>;

  if (!queue.length) return;

  const accountsByDevice = new Map<string, string[]>();
  for (const p of queue) {
    if (p.account_id) {
      const list = accountsByDevice.get(p.device_id) ?? [];
      if (!list.includes(p.account_id)) list.push(p.account_id);
      accountsByDevice.set(p.device_id, list);
    }
  }

  const insertPost = db.prepare(
    `INSERT INTO planned_posts (id, daily_plan_id, device_id, account_id, planned_time_window_start, planned_time_window_end, variance_min, variance_max, post_queue_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateQueue = db.prepare("UPDATE post_queue SET status = 'scheduled' WHERE id = ?");

  const globalPostTimes: number[] = [];
  const deviceLastPost: Map<string, number> = new Map();

  db.transaction(() => {
    for (const item of queue) {
      const plan = plans.find((p) => p.device_id === item.device_id);
      if (!plan) continue;

      let windowStart = 9 * 60 + 30;
      let windowEnd = 20 * 60 + 30;
      if (item.planned_time_start) windowStart = parseTime(item.planned_time_start);
      if (item.planned_time_end) windowEnd = parseTime(item.planned_time_end);

      const variance = opts.postVarianceMin + Math.floor(Math.random() * (opts.postVarianceMax - opts.postVarianceMin + 1));
      const base = windowStart + Math.floor(Math.random() * Math.max(1, windowEnd - windowStart - variance));
      let plannedStart = base;
      let plannedEnd = base + variance;

      const lastOnDevice = deviceLastPost.get(item.device_id) ?? 0;
      if (plannedStart < lastOnDevice + opts.sameDevicePostGap) {
        plannedStart = lastOnDevice + opts.sameDevicePostGap;
        plannedEnd = plannedStart + variance;
      }

      let attempts = 0;
      while (attempts < 100) {
        const tooCloseGlobal = globalPostTimes.some((t) => Math.abs(t - plannedStart) < opts.postBufferMax);
        if (!tooCloseGlobal) break;
        plannedStart += opts.postBufferMin + Math.floor(Math.random() * (opts.postBufferMax - opts.postBufferMin + 1));
        plannedEnd = plannedStart + variance;
        attempts++;
      }

      globalPostTimes.push(plannedStart);
      deviceLastPost.set(item.device_id, plannedStart);

      const accountId = item.account_id ?? (db.prepare("SELECT id FROM accounts WHERE device_id = ? LIMIT 1").get(item.device_id) as { id: string } | undefined)?.id;
      if (!accountId) {
        updateQueue.run(item.id);
        continue;
      }

      insertPost.run(
        uuidv4(),
        plan.id,
        item.device_id,
        accountId,
        formatTime(plannedStart),
        formatTime(plannedEnd),
        opts.postVarianceMin,
        opts.postVarianceMax,
        item.id
      );
      updateQueue.run(item.id);
    }
  })();
}
