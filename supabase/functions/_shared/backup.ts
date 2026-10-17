// ─── VELTRIX · Copia de seguridad semanal ───────────────────────────────────
// Guarda, en un depósito privado de Supabase Storage («backups»), una copia comprimida de las tablas importantes: una carpeta por día
// y un archivo por tabla. Quedan las últimas 8 copias. NO se copian las claves de los exchanges ni los códigos de vinculación
// (exchange_secrets, trade_keys, telegram_link_codes, whatsapp_codes): esas se vuelven a cargar a mano si hiciera falta restaurar.

export const BUCKET = "backups";
export const KEEP_COPIES = 8;
const PAGE = 1000;

export interface BackupTable {
  table: string;
  /** Columnas para ordenar al paginar (la clave primaria), así ninguna fila se repite ni se pierde entre páginas. */
  order: string[];
}

export const BACKUP_TABLES: BackupTable[] = [
  { table: "profiles", order: ["id"] },
  { table: "trades", order: ["id"] },
  { table: "bot_settings", order: ["user_id"] },
  { table: "bot_live", order: ["user_id"] },
  { table: "live_orders", order: ["id"] },
  { table: "bot_signals", order: ["id"] },
  { table: "unlock_history", order: ["symbol", "at", "source"] },
  { table: "token_unlocks", order: ["symbol", "at"] },
  { table: "price_alerts", order: ["id"] },
  { table: "telegram_links", order: ["user_id"] },
  { table: "telegram_communities", order: ["id"] },
  { table: "exchange_connections", order: ["id"] },
  { table: "referrals", order: ["invitee_id"] },
  { table: "ref_events", order: ["id"] },
  { table: "signal_votes", order: ["trade_id", "voter"] },
];

export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Todas las filas de una tabla, de a páginas. */
export async function fetchAllRows(supabase: any, t: BackupTable): Promise<Array<Record<string, unknown>> | null> {
  const out: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(t.table).select("*");
    for (const col of t.order) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) return null; // tabla que todavía no existe en esta base: se salta
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface BackupResult {
  day: string;
  saved: Array<{ table: string; rows: number; bytes: number }>;
  skipped: string[];
  pruned: string[];
}

export async function runBackup(supabase: any, now = Date.now(), tables: BackupTable[] = BACKUP_TABLES): Promise<BackupResult> {
  const day = isoDay(now);
  const res: BackupResult = { day, saved: [], skipped: [], pruned: [] };
  const store = supabase.storage.from(BUCKET);
  for (const t of tables) {
    const rows = await fetchAllRows(supabase, t);
    if (!rows) {
      res.skipped.push(t.table);
      continue;
    }
    const bytes = await gzip(JSON.stringify(rows));
    const { error } = await store.upload(`${day}/${t.table}.json.gz`, bytes, { contentType: "application/gzip", upsert: true });
    if (error) throw new Error(`No se pudo guardar ${t.table}: ${error.message}`);
    res.saved.push({ table: t.table, rows: rows.length, bytes: bytes.length });
  }
  // Se conservan las últimas KEEP_COPIES carpetas (los nombres son fechas, así que ordenan solos).
  const { data: top } = await store.list("", { limit: 100 });
  const days = ((top ?? []) as Array<{ name: string }>).map((x) => x.name).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  for (const old of days.slice(0, Math.max(0, days.length - KEEP_COPIES))) {
    const { data: files } = await store.list(old, { limit: 100 });
    const paths = ((files ?? []) as Array<{ name: string }>).map((f) => `${old}/${f.name}`);
    if (paths.length) await store.remove(paths);
    res.pruned.push(old);
  }
  return res;
}
