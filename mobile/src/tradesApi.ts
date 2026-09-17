// ─── DMCRIPTO · acceso a Supabase para el diario de trades (móvil) ─────────
// Espejo de src/tradesApi.ts de la web: convierte entre las filas de la
// tabla `trades` (snake_case) y el tipo `Trade` de @dmcripto/core.

import type { NewTrade, Outcome, Trade } from "@dmcripto/core";
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
