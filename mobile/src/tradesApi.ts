// ─── VELTRIX · acceso a Supabase para el diario de trades (móvil) ─────────
// Espejo de src/tradesApi.ts de la web: convierte entre las filas de la
// tabla `trades` (snake_case) y el tipo `Trade` de @dmcripto/core.

import type { DailyLimits, ExchangeConnection, ExchangeId, LiquidationMap, TelegramLink, MoneySettings, NewTrade, Outcome, Trade } from "@dmcripto/core";
import { t } from "@dmcripto/core";
import { supabase } from "./supabaseClient";

interface TradeRow {
  id: string;
  symbol: string;
  direction: Trade["direction"];
  entry: number;
  tp: number;
  sl: number;
  date: string;
  outcome: Outcome;
  exit: number | null;
  closed_at: string | null;
  notes: string | null;
  auto_closed?: boolean | null;
  tags?: string[] | null;
  source?: string | null;
}

export function rowToTrade(row: TradeRow): Trade {
  return {
    id: row.id,
    symbol: row.symbol,
    direction: row.direction,
    entry: Number(row.entry),
    tp: Number(row.tp),
    sl: Number(row.sl),
    date: row.date,
    outcome: row.outcome,
    exit: row.exit == null ? undefined : Number(row.exit),
    closedAt: row.closed_at ?? undefined,
    notes: row.notes ?? undefined,
    autoClosed: row.auto_closed ?? undefined,
    tags: row.tags ?? undefined,
    source: row.source ?? undefined,
  };
}

export async function fetchTrades(): Promise<Trade[]> {
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .order("date", { ascending: false });
  if (error) throw error;
  return (data as TradeRow[]).map(rowToTrade);
}

export async function insertTrades(userId: string, list: NewTrade[]) {
  const { error } = await supabase.from("trades").insert(
    list.map((t) => ({
      user_id: userId,
      symbol: t.symbol,
      direction: t.direction,
      entry: t.entry,
      tp: t.tp,
      sl: t.sl,
      date: t.date,
      notes: t.notes ?? null,
    })),
  );
  if (error) throw error;
}

export async function markTradeOutcome(id: string, outcome: "TP" | "SL") {
  const { error } = await supabase
    .from("trades")
    .update({ outcome, closed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function reopenTradeById(id: string) {
  const { error } = await supabase
    .from("trades")
    .update({ outcome: "ABIERTA", closed_at: null, exit: null })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteTradeById(id: string) {
  const { error } = await supabase.from("trades").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchWebhookUrl(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("webhook_token")
    .eq("id", userId)
    .single();
  if (error) throw error;
  const base = (process.env.EXPO_PUBLIC_SUPABASE_URL as string).replace(/\/$/, "");
  return `${base}/functions/v1/tradingview-webhook/${data.webhook_token}`;
}

export async function insertFullTrades(userId: string, list: Trade[]) {
  const { error } = await supabase.from("trades").insert(
    list.map((t) => ({
      user_id: userId,
      symbol: t.symbol,
      direction: t.direction,
      entry: t.entry,
      tp: t.tp,
      sl: t.sl,
      date: t.date,
      outcome: t.outcome,
      exit: t.exit ?? null,
      closed_at: t.closedAt ?? null,
      notes: t.notes ?? null,
    })),
  );
  if (error) throw error;
}

export async function closeTradeManually(id: string, exit: number) {
  const { error } = await supabase
    .from("trades")
    .update({ outcome: "MANUAL", exit, closed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteAllTrades(userId: string) {
  const { error } = await supabase.from("trades").delete().eq("user_id", userId);
  if (error) throw error;
}

export async function regenerateWebhookUrl(): Promise<string> {
  const { data, error } = await supabase.rpc("regenerate_webhook_token");
  if (error) throw error;
  const base = (process.env.EXPO_PUBLIC_SUPABASE_URL as string).replace(/\/$/, "");
  return `${base}/functions/v1/tradingview-webhook/${data}`;
}

export async function deleteMyAccount() {
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
  await supabase.auth.signOut();
}

export async function fetchAutoClose(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("profiles").select("auto_close").eq("id", userId).single();
  if (error) throw error;
  return data.auto_close !== false;
}

export async function setAutoClose(userId: string, enabled: boolean) {
  const { error } = await supabase.from("profiles").update({ auto_close: enabled }).eq("id", userId);
  if (error) throw error;
}

export async function updateTradeNotes(id: string, notes: string, tags: string[]) {
  const { error } = await supabase
    .from("trades")
    .update({ notes: notes.trim() || null, tags })
    .eq("id", id);
  if (error) throw error;
}

export async function fetchLimits(userId: string): Promise<DailyLimits> {
  const { data, error } = await supabase
    .from("profiles")
    .select("daily_loss_limit, daily_trade_limit")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return {
    maxLossR: data.daily_loss_limit == null ? null : Number(data.daily_loss_limit),
    maxTrades: data.daily_trade_limit == null ? null : Number(data.daily_trade_limit),
  };
}

export async function saveLimits(userId: string, limits: DailyLimits) {
  const { error } = await supabase
    .from("profiles")
    .update({ daily_loss_limit: limits.maxLossR, daily_trade_limit: limits.maxTrades })
    .eq("id", userId);
  if (error) throw error;
}

export async function fetchMoney(userId: string): Promise<MoneySettings> {
  const { data, error } = await supabase.from("profiles").select("capital, risk_pct, currency").eq("id", userId).single();
  if (error) throw error;
  return {
    capital: data.capital == null ? null : Number(data.capital),
    riskPct: data.risk_pct == null ? null : Number(data.risk_pct),
    currency: data.currency || "USD",
  };
}

export async function saveMoney(userId: string, m: MoneySettings) {
  const { error } = await supabase
    .from("profiles")
    .update({ capital: m.capital, risk_pct: m.riskPct, currency: m.currency.toUpperCase().slice(0, 5) || "USD" })
    .eq("id", userId);
  if (error) throw error;
}

/** Guarda el idioma elegido para que las notificaciones push lleguen en ese idioma (si la columna no existe, se ignora). */
export async function saveLang(userId: string, lang: string) {
  await supabase.from("profiles").update({ lang }).eq("id", userId);
}

// ─── Exchanges (Binance, Bybit): conexión de solo lectura ───────────────────

interface ConnRow {
  id: string;
  exchange: ExchangeId;
  key_hint: string | null;
  status: "active" | "error";
  last_error: string | null;
  last_sync_at: string | null;
  last_import_count: number | null;
}

export async function fetchConnections(): Promise<ExchangeConnection[]> {
  const { data, error } = await supabase.from("exchange_connections").select("*").order("created_at");
  if (error) throw error;
  return (data as ConnRow[]).map((r) => ({
    id: r.id,
    exchange: r.exchange,
    keyHint: r.key_hint,
    status: r.status,
    lastError: r.last_error,
    lastSyncAt: r.last_sync_at,
    lastImportCount: r.last_import_count ?? 0,
  }));
}

export interface ExchangeResult {
  ok: boolean;
  error?: string;
  code?: string;
  warning?: string;
  imported?: number;
  results?: Array<{ exchange: ExchangeId; imported: number; error?: string; skipped?: boolean }>;
}

async function callFunction<T extends { ok: boolean; error?: string }>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // Los errores con mensaje propio de la función vienen en el cuerpo de la respuesta.
    const res = (error as { context?: Response }).context;
    if (res && typeof res.json === "function") {
      try {
        return (await res.json()) as T;
      } catch {
        /* sin cuerpo */
      }
    }
    return { ok: false, error: t("No se pudo comunicar con el servidor. Probá de nuevo en unos minutos.") } as T;
  }
  return data as T;
}

const callExchanges = (body: Record<string, unknown>) => callFunction<ExchangeResult>("exchanges", body);

export const connectExchange = (exchange: ExchangeId, apiKey: string, apiSecret: string) =>
  callExchanges({ action: "connect", exchange, apiKey, apiSecret });

export const syncExchanges = () => callExchanges({ action: "sync" });

/** Desconectar borra la conexión y la clave guardada. Las operaciones ya importadas quedan en tu diario. */
export async function disconnectExchange(id: string) {
  const { error } = await supabase.from("exchange_connections").delete().eq("id", id);
  if (error) throw error;
}

// ─── Bot de Telegram ────────────────────────────────────────────────────────

interface TelegramRow {
  chat_id: number;
  username: string | null;
  linked_at: string;
}

/** El chat de Telegram vinculado a esta cuenta (o null). */
export async function fetchTelegramLink(): Promise<TelegramLink | null> {
  const { data, error } = await supabase.from("telegram_links").select("chat_id, username, linked_at").maybeSingle();
  if (error || !data) return null;
  const r = data as TelegramRow;
  return { chatId: Number(r.chat_id), username: r.username, linkedAt: r.linked_at };
}

export interface TelegramStart {
  ok: boolean;
  error?: string;
  code?: string;
  botUsername?: string;
  url?: string;
}

/** Pide un código de un solo uso y el link t.me para vincular el chat. */
export const startTelegramLink = () => callFunction<TelegramStart>("telegram-bot", { action: "link" });

export async function unlinkTelegram(userId: string) {
  const { error } = await supabase.from("telegram_links").delete().eq("user_id", userId);
  if (error) throw error;
}

// ─── Mapa de liquidaciones ──────────────────────────────────────────────────

export interface LiquidationResult {
  ok: boolean;
  error?: string;
  data?: LiquidationMap;
  stale?: boolean;
}

export const fetchLiquidationMap = (coin: string) => callFunction<LiquidationResult>("liquidation-map", { coin });

// ─── Resumen diario ─────────────────────────────────────────────────────────

/** Guarda la zona horaria del dispositivo: el resumen sale a las 21:00 de esa zona. */
export async function saveTimezone(userId: string) {
  let tz: string | undefined;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return;
  }
  if (tz) await supabase.from("profiles").update({ timezone: tz }).eq("id", userId);
}

export async function fetchDailySummary(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("profiles").select("daily_summary").eq("id", userId).single();
  if (error) throw error;
  return data.daily_summary !== false;
}

export async function setDailySummary(userId: string, enabled: boolean) {
  const { error } = await supabase.from("profiles").update({ daily_summary: enabled }).eq("id", userId);
  if (error) throw error;
}
