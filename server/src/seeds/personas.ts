import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

const PERSONAS = [
  {
    name: "After-School Binger",
    // 3pm to 7:30pm core window, but sessions get jittered inside.
    active_window_start: "15:00",
    active_window_end: "19:30",
    session_count_min: 4,
    session_count_max: 6,
    session_duration_min: 15,
    session_duration_max: 45,
    // Single usage window, jitter handled in generator.
    peak_bias_windows: JSON.stringify([{ start: "15:00", end: "19:30" }]),
    weekend_modifiers: JSON.stringify({ session_count_mult: 1.2 }),
    niche_exposure_min: 0.6,
    niche_exposure_max: 0.75,
    secondary_interest_tags: JSON.stringify(["gaming", "memes", "music"]),
  },
  {
    name: "College Commuter",
    // 8–9:20, 12:30–13:40, 17:00–19:30
    active_window_start: "08:00",
    active_window_end: "19:30",
    session_count_min: 3,
    session_count_max: 5,
    session_duration_min: 10,
    session_duration_max: 30,
    peak_bias_windows: JSON.stringify([
      { start: "08:00", end: "09:20" },
      { start: "12:30", end: "13:40" },
      { start: "17:00", end: "19:30" },
    ]),
    weekend_modifiers: JSON.stringify({ session_count_mult: 0.8 }),
    niche_exposure_min: 0.5,
    niche_exposure_max: 0.7,
    secondary_interest_tags: JSON.stringify(["study", "campus", "food"]),
  },
  {
    name: "First Job Professional",
    // 9–10, 12–13:30, 17–19:24
    active_window_start: "09:00",
    active_window_end: "19:24",
    session_count_min: 2,
    session_count_max: 4,
    session_duration_min: 10,
    session_duration_max: 25,
    peak_bias_windows: JSON.stringify([
      { start: "09:00", end: "10:00" },
      { start: "12:00", end: "13:30" },
      { start: "17:00", end: "19:24" },
    ]),
    weekend_modifiers: JSON.stringify({ session_count_mult: 1.0 }),
    niche_exposure_min: 0.55,
    niche_exposure_max: 0.7,
    secondary_interest_tags: JSON.stringify(["career", "wellness", "news"]),
  },
  {
    name: "Casual Observer",
    // 11am to 7pm
    active_window_start: "11:00",
    active_window_end: "19:00",
    session_count_min: 2,
    session_count_max: 4,
    session_duration_min: 8,
    session_duration_max: 20,
    peak_bias_windows: JSON.stringify([{ start: "11:00", end: "19:00" }]),
    weekend_modifiers: JSON.stringify({ session_count_mult: 1.1 }),
    niche_exposure_min: 0.4,
    niche_exposure_max: 0.6,
    secondary_interest_tags: JSON.stringify(["lifestyle", "travel", "food"]),
  },
  {
    name: "Irregular Creator",
    // 10–12, 14–19:20
    active_window_start: "10:00",
    active_window_end: "19:20",
    session_count_min: 1,
    session_count_max: 3,
    session_duration_min: 20,
    session_duration_max: 60,
    peak_bias_windows: JSON.stringify([
      { start: "10:00", end: "12:00" },
      { start: "14:00", end: "19:20" },
    ]),
    weekend_modifiers: JSON.stringify({ session_count_mult: 1.3 }),
    niche_exposure_min: 0.65,
    niche_exposure_max: 0.85,
    secondary_interest_tags: JSON.stringify(["content", "creativity", "art"]),
  },
];

export function seedPersonas(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT INTO personas (
      id, name, active_window_start, active_window_end,
      session_count_min, session_count_max, session_duration_min, session_duration_max,
      peak_bias_windows, weekend_modifiers, niche_exposure_min, niche_exposure_max,
      secondary_interest_tags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const update = db.prepare(`
    UPDATE personas SET
      active_window_start = ?,
      active_window_end = ?,
      session_count_min = ?,
      session_count_max = ?,
      session_duration_min = ?,
      session_duration_max = ?,
      peak_bias_windows = ?,
      weekend_modifiers = ?,
      niche_exposure_min = ?,
      niche_exposure_max = ?,
      secondary_interest_tags = ?
    WHERE id = ?
  `);

  for (const p of PERSONAS) {
    const existing = db
      .prepare("SELECT id FROM personas WHERE name = ?")
      .get(p.name) as { id: string } | undefined;

    if (existing) {
      update.run(
        p.active_window_start,
        p.active_window_end,
        p.session_count_min,
        p.session_count_max,
        p.session_duration_min,
        p.session_duration_max,
        p.peak_bias_windows,
        p.weekend_modifiers,
        p.niche_exposure_min,
        p.niche_exposure_max,
        p.secondary_interest_tags,
        existing.id
      );
    } else {
      insert.run(
        uuidv4(),
        p.name,
        p.active_window_start,
        p.active_window_end,
        p.session_count_min,
        p.session_count_max,
        p.session_duration_min,
        p.session_duration_max,
        p.peak_bias_windows,
        p.weekend_modifiers,
        p.niche_exposure_min,
        p.niche_exposure_max,
        p.secondary_interest_tags
      );
    }
  }
}
