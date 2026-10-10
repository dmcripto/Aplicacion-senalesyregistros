// ─── VELTRIX · Votación 👍/👎 de las señales en los grupos de Telegram ──────────
// Archivo aparte (sin dependencias) para que community.ts pueda usarlo sin ciclos de importación.

export interface VoteCount {
  up: number;
  down: number;
}

export const voteData = (kind: "u" | "d", tradeId: string) => `v:${kind}:${tradeId}`;

export function voteKeyboard(tradeId: string, c: VoteCount = { up: 0, down: 0 }, lang: "es" | "en" = "es") {
  const en = lang === "en";
  return {
    inline_keyboard: [[
      { text: `👍 ${en ? "I'm taking it" : "La tomo"}${c.up ? ` · ${c.up}` : ""}`, callback_data: voteData("u", tradeId) },
      { text: `👎 ${en ? "I'll pass" : "Paso"}${c.down ? ` · ${c.down}` : ""}`, callback_data: voteData("d", tradeId) },
    ]],
  };
}

export function parseVote(data: string): { kind: "u" | "d"; tradeId: string } | null {
  const m = /^v:([ud]):([0-9a-zA-Z-]{8,40})$/.exec(data);
  return m ? { kind: m[1] as "u" | "d", tradeId: m[2] } : null;
}

/** Registra (o cambia, o quita si repite) el voto de una persona y devuelve el recuento. Null si falta la tabla. */
export async function castVote(supabase: any, tradeId: string, voter: number, kind: "u" | "d"): Promise<VoteCount | null> {
  const vote = kind === "u" ? 1 : -1;
  const { data: prev, error } = await supabase.from("signal_votes").select("vote").eq("trade_id", tradeId).eq("voter", voter).maybeSingle();
  if (error) return null;
  if (prev?.vote === vote) await supabase.from("signal_votes").delete().eq("trade_id", tradeId).eq("voter", voter);
  else await supabase.from("signal_votes").upsert({ trade_id: tradeId, voter, vote }, { onConflict: "trade_id,voter" });
  const { data: all } = await supabase.from("signal_votes").select("vote").eq("trade_id", tradeId);
  const list = (all ?? []) as Array<{ vote: number }>;
  return { up: list.filter((x) => x.vote > 0).length, down: list.filter((x) => x.vote < 0).length };
}

