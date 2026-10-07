// ─── VELTRIX · acceso a Supabase para el diario de trades ─────────────────
// Convierte entre las filas de la tabla `trades` (snake_case) y el tipo
// `Trade` de @dmcripto/core (camelCase), y expone las mutaciones que antes
// vivían como setState directo sobre localStorage.

import { BOT_PROFILE_LIST, BOT_SCAN_LIST, DEFAULT_BOT, DEFAULT_LIVE, LIQ_COINS, t } from "./lib";
import { supabase } from "./supabaseClient";
import type { BotAction, BotBacktest, BotLab, BotLoaded, BotProfileId, LiveOrder, LiveSettings, BotScan, BotSettings, CoachResult, DailyLimits, TelegramCommunity, ExchangeConnection, ExchangeId, LiquidationMap, TelegramLink, WhatsAppState, MoneySettings, NewTrade, Outcome, Trade } from "./lib";

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
  leverage?: number | null;
  size_usd?: number | null;
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
    leverage: row.leverage == null ? undefined : Number(row.leverage),
    sizeUsd: row.size_usd == null ? undefined : Number(row.size_usd),
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

export async function insertTrades(userId: string, list: NewTrade[]): Promise<string[]> {
  const rows = (withTargets: boolean) =>
    list.map((t) => ({
      user_id: userId,
      symbol: t.symbol,
      direction: t.direction,
      entry: t.entry,
      tp: t.tp,
      sl: t.sl,
      ...(withTargets && t.targets?.length ? { targets: t.targets } : {}),
      ...(withTargets && t.leverage ? { leverage: t.leverage } : {}),
      date: t.date,
      notes: t.notes ?? null,
    }));
  let { data, error } = await supabase.from("trades").insert(rows(true)).select("id");
  // Si todavía no se corrió el SQL de los targets o del apalancamiento, se guarda igual (sin esos datos).
  if (error && list.some((t) => t.targets?.length || t.leverage)) ({ data, error } = await supabase.from("trades").insert(rows(false)).select("id"));
  if (error) throw error;
  return (data as { id: string }[]).map((row) => row.id);
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

export async function markTradeOutcome(id: string, outcome: "TP" | "SL") {
  const { error } = await supabase
    .from("trades")
    .update({ outcome, closed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function closeTradeManually(id: string, exit: number) {
  const { error } = await supabase
    .from("trades")
    .update({ outcome: "MANUAL", exit, closed_at: new Date().toISOString() })
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

export async function deleteAllTrades(userId: string) {
  const { error } = await supabase.from("trades").delete().eq("user_id", userId);
  if (error) throw error;
}

export async function fetchWebhookUrl(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("webhook_token")
    .eq("id", userId)
    .single();
  if (error) throw error;
  const base = import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, "");
  return `${base}/functions/v1/tradingview-webhook/${data.webhook_token}`;
}

export async function regenerateWebhookUrl(): Promise<string> {
  const { data, error } = await supabase.rpc("regenerate_webhook_token");
  if (error) throw error;
  const base = import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, "");
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
  const { data, error } = await supabase.from("exchange_connections").delete().eq("id", id).select("id");
  if (error) throw error;
  // Con la verificación en dos pasos activa, el servidor ignora el borrado si falta el código reciente (no da error, no borra nada).
  if (!data?.length) throw new Error(t("No se pudo desconectar. Si tenés la verificación en dos pasos activada, confirmá con tu código e intentá de nuevo."));
}

// ─── Bot automático (etapa simulada) ────────────────────────────────────────

/** Los ajustes del bot de esta persona (si todavía no los guardó, los de fábrica: apagado). Falla si el servidor no tiene la tabla del bot. */
export async function fetchBotSettings(userId: string): Promise<BotLoaded> {
  // El bot está en prueba: solo lo ven las cuentas habilitadas (profiles.bot_beta). Sin la columna, o sin la llave, queda oculto.
  const { data: beta, error: betaErr } = await supabase.from("profiles").select("bot_beta").eq("id", userId).maybeSingle();
  if (betaErr || !(beta as { bot_beta?: boolean } | null)?.bot_beta) throw new Error("El bot todavía no está disponible para tu cuenta.");
  const { data, error } = await supabase.from("bot_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) {
    // Sin fila todavía: se mira si cada columna opcional existe preguntándole por ella.
    const [r, p, n, sc] = await Promise.all([supabase.from("bot_settings").select("rules").limit(1), supabase.from("bot_settings").select("profile").limit(1), supabase.from("bot_settings").select("notify").limit(1), supabase.from("bot_settings").select("scan_top").limit(1)]);
    return { ...DEFAULT_BOT, rulesSupported: !r.error, profileSupported: !p.error, notifySupported: !n.error, scanSupported: !sc.error };
  }
  const row = data as { rules?: unknown; profile?: unknown; notify?: unknown; scan_top?: unknown };
  const rulesSupported = Array.isArray(row.rules);
  const profileSupported = typeof row.profile === "string";
  const notifySupported = typeof row.notify === "boolean";
  const scanSupported = typeof row.scan_top === "number";
  return {
    enabled: !!data.enabled,
    symbols: (data.symbols as string[]) ?? DEFAULT_BOT.symbols,
    maxOpen: Number(data.max_open ?? DEFAULT_BOT.maxOpen),
    dailyLossR: Number(data.daily_loss_r ?? DEFAULT_BOT.dailyLossR),
    lastTickAt: data.last_tick_at ?? null,
    updatedAt: data.updated_at ?? null,
    rules: rulesSupported ? (row.rules as BotAction[]) : [],
    profile: profileSupported && (BOT_PROFILE_LIST as string[]).includes(row.profile as string) ? (row.profile as BotProfileId) : "balanced",
    notify: notifySupported ? (row.notify as boolean) : true,
    scanTop: scanSupported && BOT_SCAN_LIST.includes(row.scan_top as BotScan) ? (row.scan_top as BotScan) : 0,
    rulesSupported,
    profileSupported,
    notifySupported,
    scanSupported,
  };
}

export async function saveBotSettings(userId: string, s: BotSettings, caps: { rules: boolean; profile: boolean; notify: boolean; scan: boolean } = { rules: true, profile: true, notify: true, scan: true }) {
  const row: Record<string, unknown> = { user_id: userId, enabled: s.enabled, symbols: s.symbols, max_open: s.maxOpen, daily_loss_r: s.dailyLossR, updated_at: new Date().toISOString() };
  if (caps.rules) row.rules = s.rules;
  if (caps.profile) row.profile = s.profile;
  if (caps.notify) row.notify = s.notify;
  if (caps.scan) row.scan_top = s.scanTop;
  const { error } = await supabase.from("bot_settings").upsert(row, { onConflict: "user_id" });
  if (error) throw error;
}

/** Prueba la estrategia con el historial real de precios (no toca nada). */
export const runBotBacktest = (symbols: string[], days = 120) => callFunction<BotBacktest & { ok: boolean; error?: string }>("bot", { action: "backtest", symbols, days });

/** Laboratorio: varias versiones de la estrategia (velas de 1 y 4 horas) sobre un año de precios, por mitades. */
export const runBotLab = (symbols: string[]) => callFunction<BotLab & { ok: boolean; error?: string }>("bot", { action: "lab", symbols });

/** Crea una señal abierta de prueba en tu cuenta (solo cuentas habilitadas) y manda el aviso. No se publica en comunidades. */
export const sendTestSignal = () => callFunction<{ ok: boolean; error?: string; tradeId?: string; entry?: number }>("bot", { action: "test_signal" });

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

export async function fetchWhatsappButton(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("profiles").select("whatsapp_button").eq("id", userId).single();
  if (error) throw error;
  return data.whatsapp_button === true;
}

export async function setWhatsappButton(userId: string, enabled: boolean) {
  const { error } = await supabase.from("profiles").update({ whatsapp_button: enabled }).eq("id", userId);
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

// ─── Bot con dinero real (prueba mínima, solo Bitunix) ──────────────────────

export interface LiveView {
  hasKey: boolean;
  keyHint: string | null;
  live: LiveSettings;
  orders: LiveOrder[];
}

type LiveReply = { ok: boolean; error?: string; code?: string; steps?: string[]; preview?: boolean; verified?: boolean; available?: number };
const callTrade = (body: Record<string, unknown>) => callFunction<LiveReply & { hasKey?: boolean; keyHint?: string | null; live?: Record<string, unknown> | null }>("trade", body);

const liveFromRow = (r: Record<string, unknown> | null | undefined): LiveSettings =>
  r
    ? {
        enabled: r.enabled === true,
        dryRun: r.dry_run !== false,
        verified: r.verified === true,
        maxMarginUsdt: Number(r.max_margin_usdt ?? DEFAULT_LIVE.maxMarginUsdt),
        riskUsdt: Number(r.risk_usdt ?? DEFAULT_LIVE.riskUsdt),
        maxLeverage: Number(r.max_leverage ?? DEFAULT_LIVE.maxLeverage),
        maxOpen: Number(r.max_open ?? DEFAULT_LIVE.maxOpen),
        dailyLossUsdt: Number(r.daily_loss_usdt ?? DEFAULT_LIVE.dailyLossUsdt),
        errors: Number(r.errors ?? 0),
        lastError: (r.last_error as string | null) ?? null,
      }
    : DEFAULT_LIVE;

/** Estado del bot real. Si la función o las tablas todavía no existen (falta el SQL o el despliegue), lanza error y la pantalla no se muestra. */
export async function fetchLive(userId: string): Promise<LiveView> {
  const st = await callTrade({ action: "status" });
  if (!st.ok) throw new Error(st.error ?? "no disponible");
  const { data } = await supabase.from("live_orders").select("id, symbol, side, qty, leverage, kind, status, note, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(12);
  const orders = ((data ?? []) as Array<Record<string, unknown>>).map((o) => ({
    id: String(o.id),
    symbol: String(o.symbol),
    side: String(o.side),
    qty: o.qty == null ? null : Number(o.qty),
    leverage: o.leverage == null ? null : Number(o.leverage),
    kind: o.kind as LiveOrder["kind"],
    status: o.status as LiveOrder["status"],
    note: (o.note as string | null) ?? null,
    createdAt: String(o.created_at),
  }));
  return { hasKey: !!st.hasKey, keyHint: st.keyHint ?? null, live: liveFromRow(st.live), orders };
}

/** Guarda los ajustes (la base rechaza lo que pase los topes, y no deja enviar de verdad sin la orden de prueba). */
export async function saveLive(userId: string, p: Partial<Pick<LiveSettings, "enabled" | "dryRun" | "maxMarginUsdt" | "riskUsdt" | "maxLeverage" | "maxOpen" | "dailyLossUsdt">>) {
  const row: Record<string, unknown> = {};
  if (p.enabled !== undefined) row.enabled = p.enabled;
  if (p.dryRun !== undefined) row.dry_run = p.dryRun;
  if (p.maxMarginUsdt !== undefined) row.max_margin_usdt = p.maxMarginUsdt;
  if (p.riskUsdt !== undefined) row.risk_usdt = p.riskUsdt;
  if (p.maxLeverage !== undefined) row.max_leverage = p.maxLeverage;
  if (p.maxOpen !== undefined) row.max_open = p.maxOpen;
  if (p.dailyLossUsdt !== undefined) row.daily_loss_usdt = p.dailyLossUsdt;
  const { error } = await supabase.from("bot_live").update(row).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export const connectTradeKey = (apiKey: string, apiSecret: string) => callTrade({ action: "connect_key", apiKey, apiSecret });
export const disconnectTradeKey = () => callTrade({ action: "disconnect_key" });
export const testLiveOrder = (confirm: boolean) => callTrade({ action: "test_order", confirm });
export const liveStop = () => callTrade({ action: "panic" });
