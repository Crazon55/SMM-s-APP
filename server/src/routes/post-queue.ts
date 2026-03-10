import { Router, Request, Response } from "express";
import { getDb } from "../db/index.js";
import { v4 as uuidv4 } from "uuid";
import type { PostQueueItem } from "../types/index.js";

export const postQueueRouter = Router();

function ingestItems(req: Request, res: Response): void {
  const body = req.body;
  const items: PostQueueItem[] = Array.isArray(body)
    ? body
    : body?.items
      ? body.items
      : body?.device_id
        ? [body as PostQueueItem]
        : [];

  if (!items.length) {
    res.status(400).json({ error: "No items to ingest" });
    return;
  }

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO post_queue (id, device_id, account_id, planned_date, planned_time_start, planned_time_end, content_ref, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
  );

  let count = 0;
  db.transaction(() => {
    for (const it of items) {
      if (!it.device_id || !it.planned_date) continue;
      insert.run(
        uuidv4(),
        it.device_id,
        it.account_id ?? null,
        it.planned_date,
        it.planned_time_start ?? null,
        it.planned_time_end ?? null,
        it.content_ref ?? null
      );
      count++;
    }
  })();

  res.status(201).json({ ok: true, count });
}

postQueueRouter.post("/ingest", ingestItems);
postQueueRouter.post("/import", ingestItems);
