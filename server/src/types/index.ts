export type DailyMode = "light" | "normal" | "heavy" | "post_only";
export type DeviceStatus = "active" | "paused" | "retired";
export type SessionLogStatus = "completed" | "missed" | "late";
export type PostLogStatus = "completed" | "missed" | "late";

export interface Persona {
  id: string;
  name: string;
  active_window_start: string;
  active_window_end: string;
  session_count_min: number;
  session_count_max: number;
  session_duration_min: number;
  session_duration_max: number;
  peak_bias_windows: string | null;
  weekend_modifiers: string | null;
  niche_exposure_min: number | null;
  niche_exposure_max: number | null;
  secondary_interest_tags: string | null;
}

export interface Device {
  id: string;
  name: string;
  device_unique_id: string | null;
  persona_id: string;
  operator_id: string | null;
  status: DeviceStatus;
  token_hash: string | null;
}

export interface Operator {
  id: string;
  name: string;
  coverage_weekday: number;
  coverage_weekend: number;
}

export interface Account {
  id: string;
  device_id: string;
  display_name: string | null;
  account_identifier: string | null;
}

export interface PlannedSession {
  id: string;
  daily_plan_id: string;
  device_id: string;
  planned_start: string;
  planned_duration_min: number;
  sort_order: number;
}

export interface PlannedPost {
  id: string;
  daily_plan_id: string;
  device_id: string;
  account_id: string;
  planned_time_window_start: string;
  planned_time_window_end: string;
  variance_min: number;
  variance_max: number;
}

export interface DailyPlan {
  id: string;
  device_id: string;
  plan_date: string;
  daily_mode: DailyMode;
  session_count: number;
}

export interface SessionLogPayload {
  session_id: string;
  planned_start: string;
  planned_duration_min: number;
  actual_start?: string;
  actual_end?: string;
  status: SessionLogStatus;
  idempotency_key?: string;
}

export interface PostLogPayload {
  account_id: string;
  planned_time_start?: string;
  planned_time_end?: string;
  actual_time: string;
  status: PostLogStatus;
  idempotency_key?: string;
}

export interface PostQueueItem {
  device_id: string;
  account_id?: string;
  planned_date: string;
  planned_time_start?: string;
  planned_time_end?: string;
  content_ref?: string;
}
