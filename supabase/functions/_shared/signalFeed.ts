// ─── VELTRIX · Señales de VELTRIX (reparto a quienes lo activaron) ──────────
// Cuando una cuenta emisora (profiles.signal_provider) recibe una alerta, esta función copia la señal al diario de
// cada persona con follow_signals (source = 'veltrix') y le manda el aviso (push de la app y Telegram, si los tiene).
// Una persona recibe cada señal una sola vez: la copia se identifica con el id de la operación del emisor.

import { sendExpoPush } from "./expoPush.ts";
import type { PushMessage } from "./expoPush.ts";
import { signalCardHtml } from "./community.ts";
import { notifyTelegram } from "./telegram.ts";
import { waSignalText } from "./whatsapp.ts";

export const FEED_SOURCE = "veltrix";

const PAGE = 500; // personas por tanda
const PUSH_BATCH = 100; // límite de Expo por pedido
const TELEGRAM_PARALLEL = 5;

export interface FeedSignal {
  symbol: string;
  direction: "LONG" | "SHORT";
  entry: number;
  tp: number;
  sl: number;
  targets?: number[];
}

/** Copia la señal a quienes la siguen y los avisa. Nunca lanza errores: un fallo acá no debe afectar la señal del emisor. */
export async function fanOutSignal(
  supabase: any,
  providerId: string,
  providerTradeId: string,
  sig: FeedSignal,
  date: string,
): Promise<{ followers: number; copied: number }> {
  let followers = 0;
  let copied = 0;
  try {
    for (let from = 0; ; from += PAGE) {
      const { data: people, error } = await supabase
        .from("profiles")
        .select("id, lang")
        .eq("follow_signals", true)
        .neq("id", providerId)
        .order("id")
        .range(from, from + PAGE - 1);
      // Si todavía no se corrió el SQL (la columna no existe), no hay a quién repartir.
      if (error || !people?.length) break;
      followers += people.length;
      const langOf = new Map<string, string | undefined>(people.map((p: { id: string; lang?: string }) => [p.id, p.lang]));

      const base = (id: string) => ({ user_id: id, symbol: sig.symbol, direction: sig.direction, entry: sig.entry, tp: sig.tp, sl: sig.sl, date, source: FEED_SOURCE, external_id: providerTradeId });
      const rows = people.map((p: { id: string }) => (sig.targets?.length ? { ...base(p.id), targets: sig.targets } : base(p.id)));
      const insert = (r: Record<string, unknown>[]) => supabase.from("trades").upsert(r, { onConflict: "user_id,source,external_id", ignoreDuplicates: true }).select("id, user_id");
      let { data: made, error: insertError } = await insert(rows);
      // Si todavía no se corrió el SQL de los targets, la copia se guarda igual (solo con el TP final).
      if (insertError && sig.targets?.length) ({ data: made, error: insertError } = await insert(rows.map(({ targets: _t, ...r }: Record<string, unknown>) => r)));
      if (insertError || !made?.length) {
        if (insertError) console.error("señales de VELTRIX:", insertError.message);
      } else {
        copied += made.length;
        const tradeOf = new Map<string, string>(made.map((m: { id: string; user_id: string }) => [m.user_id, m.id]));
        const ids = [...tradeOf.keys()];

        const { data: tokens } = await supabase.from("device_tokens").select("user_id, expo_push_token").in("user_id", ids);
        const messages: PushMessage[] = (tokens ?? []).map((t: { user_id: string; expo_push_token: string }) => {
          const en = langOf.get(t.user_id) === "en";
          return {
            to: t.expo_push_token,
            title: `${sig.symbol} · ${sig.direction === "LONG" ? (en ? "BUY" : "COMPRA") : en ? "SELL" : "VENTA"}`,
            body: `${en ? "Entry" : "Entrada"} ${sig.entry} · TP ${sig.targets?.length ? [...sig.targets, sig.tp].join(" / ") : sig.tp} · SL ${sig.sl}`,
            data: { tradeId: tradeOf.get(t.user_id) },
          };
        });
        for (let i = 0; i < messages.length; i += PUSH_BATCH) {
          try {
            await sendExpoPush(messages.slice(i, i + PUSH_BATCH));
          } catch (e) {
            console.error("señales de VELTRIX (push):", e instanceof Error ? e.message : e);
          }
        }

        for (let i = 0; i < ids.length; i += TELEGRAM_PARALLEL) {
          await Promise.all(
            ids.slice(i, i + TELEGRAM_PARALLEL).map((id) =>
              notifyTelegram(supabase, id, (lang) => signalCardHtml(sig, lang, { header: "🔔" }), (lang) => waSignalText(sig, lang)),
            ),
          );
        }
      }
      if (people.length < PAGE) break;
    }
  } catch (e) {
    console.error("señales de VELTRIX:", e instanceof Error ? e.message : e);
  }
  return { followers, copied };
}
