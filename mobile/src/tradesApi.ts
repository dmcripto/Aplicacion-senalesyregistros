// ─── VELTRIX · acceso a Supabase para el diario de trades (móvil) ─────────
// Espejo de src/tradesApi.ts de la web: convierte entre las filas de la
// tabla `trades` (snake_case) y el tipo `Trade` de @dmcripto/core.

import type { BotBacktest, BotSettings, CoachResult, DailyLimits, TelegramCommunity, ExchangeConnection, ExchangeId, LiquidationMap, TelegramLink, WhatsAppState, MoneySettings, NewTrade, Outcome, Trade } from "@dmcripto/core";
import { DEFAULT_BOT, LIQ_COINS, t } from "@dmcripto/core";
import { supabase } from "./supabaseClient";

interface TradeRow {
  id: string;
  symbol: string;
  direction: Trade["direction"];
  entry: number;
  tp: number;
  sl: number;
  targets?: number[] | null;
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
    targets: row.targets?.length ? row.targets.map(Number) : undefined,
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
  const rows = (withTargets: boolean) =>
    list.map((t) => ({
      user_id: userId,
      symbol: t.symbol,
      direction: t.direction,
      entry: t.entry,
      tp: t.tp,
      sl: t.sl,
      ...(withTargets && t.targets?.length ? { targets: t.targets } : {}),
      date: t.date,
      notes: t.notes ?? null,
    }));
  let { error } = await supabase.from("trades").insert(rows(true));
  // Si todavía no se corrió el SQL de los targets, se guarda igual (solo con el TP final).
  if (error && list.some((t) => t.targets?.length)) ({ error } = await supabase.from("trades").insert(rows(false)));
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

/** Avisos de borrado hechos desde esta misma app: el aviso en tiempo real de borrado no llega con filtro por usuario. */
type DeleteListener = (ids: string[] | "all") => void;
const deleteListeners = new Set<DeleteListener>();
export const onLocalDelete = (fn: DeleteListener) => {
  deleteListeners.add(fn);
  return () => void deleteListeners.delete(fn);
};

export async function deleteTradeById(id: string) {
  const { error } = await supabase.from("trades").delete().eq("id", id);
  if (error) throw error;
  deleteListeners.forEach((fn) => fn([id]));
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
  deleteListeners.forEach((fn) => fn("all"));
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

// ─── Exchanges (Binance, Bybit, Bitunix, MEXC, Gate, Bitget, OKX, KuCoin): conexión de solo lectura ───────────────────

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

export const connectExchange = (exchange: ExchangeId, apiKey: string, apiSecret: string, passphrase?: string) =>
  callExchanges({ action: "connect", exchange, apiKey, apiSecret, ...(passphrase ? { passphrase } : {}) });

export const syncExchanges = () => callExchanges({ action: "sync" });

/** Desconectar borra la conexión y la clave guardada. Las operaciones ya importadas quedan en tu diario. */
export async function disconnectExchange(id: string) {
  const { error } = await supabase.from("exchange_connections").delete().eq("id", id);
  if (error) throw error;
}

// ─── Bot automático (etapa simulada) ────────────────────────────────────────

/** Los ajustes del bot de esta persona (si todavía no los guardó, los de fábrica: apagado). */
export async function fetchBotSettings(userId: string): Promise<BotSettings> {
  const { data, error } = await supabase.from("bot_settings").select("enabled, symbols, max_open, daily_loss_r, last_tick_at").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_BOT;
  return {
    enabled: !!data.enabled,
    symbols: (data.symbols as string[]) ?? DEFAULT_BOT.symbols,
    maxOpen: Number(data.max_open ?? DEFAULT_BOT.maxOpen),
    dailyLossR: Number(data.daily_loss_r ?? DEFAULT_BOT.dailyLossR),
    lastTickAt: data.last_tick_at ?? null,
  };
}

export async function saveBotSettings(userId: string, s: BotSettings) {
  const { error } = await supabase
    .from("bot_settings")
    .upsert({ user_id: userId, enabled: s.enabled, symbols: s.symbols, max_open: s.maxOpen, daily_loss_r: s.dailyLossR, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

/** Prueba la estrategia con el historial real de precios (no toca nada). */
export const runBotBacktest = (symbols: string[], days = 120) => callFunction<BotBacktest & { ok: boolean; error?: string }>("bot", { action: "backtest", symbols, days });

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

/** Activos con contrato perpetuo (para el buscador del mapa). Si falla, quedan los más conocidos. */
export async function fetchLiquidationCoins(): Promise<string[]> {
  const r = await callFunction<{ ok: boolean; coins?: string[] }>("liquidation-map", { action: "list" });
  return r.ok && r.coins?.length ? r.coins : LIQ_COINS;
}


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

export async function fetchPartialAlerts(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("profiles").select("partial_alerts").eq("id", userId).single();
  if (error) throw error;
  return data.partial_alerts !== false;
}

export async function setPartialAlerts(userId: string, enabled: boolean) {
  const { error } = await supabase.from("profiles").update({ partial_alerts: enabled }).eq("id", userId);
  if (error) throw error;
}

// ─── Coach con IA ───────────────────────────────────────────────────────────

export const fetchCoach = () => callFunction<CoachResult & { ok: boolean }>("coach", {}) as Promise<CoachResult>;

// ─── Comunidad de Telegram (grupo o canal donde el bot publica tus señales) ─

export interface CommunityStart {
  ok: boolean;
  error?: string;
  code?: string;
  command?: string;
  botUsername?: string;
  addToGroupUrl?: string;
  addToChannelUrl?: string;
}

export const startCommunityLink = () => callFunction<CommunityStart>("telegram-bot", { action: "community_code" });

export async function fetchCommunities(): Promise<TelegramCommunity[]> {
  const { data, error } = await supabase.from("telegram_communities").select("id, chat_id, title, linked_at").order("linked_at");
  if (error || !data) return [];
  return (data as Array<{ id: string; chat_id: number | string; title: string | null; linked_at: string }>).map((r) => ({
    id: r.id,
    chatId: Number(r.chat_id),
    title: r.title,
    linkedAt: r.linked_at,
  }));
}

export async function removeCommunity(id: string) {
  const { error } = await supabase.from("telegram_communities").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchWhatsappButton(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("profiles").select("whatsapp_button").eq("id", userId).single();
  if (error) throw error;
  return data.whatsapp_button === true;
}

export async function setWhatsappButton(userId: string, enabled: boolean) {
  const { error } = await supabase.from("profiles").update({ whatsapp_button: enabled }).eq("id", userId);
  if (error) throw error;
}

// ─── Señales por WhatsApp (API oficial: la persona vincula su número con un código) ─

type WaReply = { ok: boolean; error?: string };

/** Si el servidor todavía no tiene WhatsApp (o no responde), se devuelve «no configurado» y la pantalla no muestra nada. */
export async function fetchWhatsApp(): Promise<WhatsAppState> {
  const r = await callFunction<WaReply & Partial<WhatsAppState>>("whatsapp", { action: "status" });
  return r.ok ? { configured: !!r.configured, link: r.link ?? null } : { configured: false, link: null };
}
export const startWhatsApp = (phone: string) => callFunction<WaReply & { minutes?: number }>("whatsapp", { action: "start", phone });
export const verifyWhatsApp = (code: string) => callFunction<WaReply & { link?: { phone: string; enabled: boolean } }>("whatsapp", { action: "verify", code });
export const toggleWhatsApp = (enabled: boolean) => callFunction<WaReply>("whatsapp", { action: "toggle", enabled });
export const unlinkWhatsApp = () => callFunction<WaReply>("whatsapp", { action: "unlink" });
