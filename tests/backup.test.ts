import { describe, expect, it } from "vitest";
import { BACKUP_TABLES, fetchAllRows, gzip, runBackup } from "../supabase/functions/_shared/backup";

// Base y depósito mínimos en memoria.
function fakeSupabase(tables: Record<string, Array<Record<string, unknown>>>, folders: Record<string, string[]> = {}) {
  const files: Record<string, { bytes: Uint8Array }> = {};
  const removed: string[] = [];
  const fs: Record<string, string[]> = { ...folders };
  const client = {
    from(table: string) {
      const rows = tables[table];
      const q: any = {
        order: () => q,
        select: () => q,
        range: async (a: number, b: number) => (rows ? { data: rows.slice(a, b + 1), error: null } : { data: null, error: { message: "relation does not exist" } }),
      };
      return q;
    },
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array) => {
          files[path] = { bytes };
          const [d, f] = path.split("/");
          (fs[d] ??= []).push(f);
          return { error: null };
        },
        list: async (dir: string) => ({ data: dir === "" ? Object.keys(fs).map((name) => ({ name })) : (fs[dir] ?? []).map((name) => ({ name })) }),
        remove: async (paths: string[]) => { removed.push(...paths); return { error: null }; },
      }),
    },
  };
  return { client, files, removed };
}

describe("copia de seguridad", () => {
  it("pagina todas las filas y comprime", async () => {
    const rows = Array.from({ length: 2300 }, (_, i) => ({ id: i }));
    const { client } = fakeSupabase({ trades: rows });
    expect((await fetchAllRows(client, { table: "trades", order: ["id"] }))!.length).toBe(2300);
    const gz = await gzip(JSON.stringify(rows));
    expect(gz[0]).toBe(0x1f); // cabecera gzip
    expect(gz[1]).toBe(0x8b);
  });

  it("guarda un archivo por tabla en la carpeta del día, salta las tablas que no existen y no incluye claves", async () => {
    const { client, files } = fakeSupabase({ trades: [{ id: "a" }, { id: "b" }], profiles: [{ id: "u1" }] });
    const r = await runBackup(client, Date.parse("2026-10-17T12:00:00Z"));
    expect(r.day).toBe("2026-10-17");
    expect(Object.keys(files).sort()).toEqual(["2026-10-17/profiles.json.gz", "2026-10-17/trades.json.gz"]);
    expect(r.saved.find((s) => s.table === "trades")!.rows).toBe(2);
    expect(r.skipped).toContain("live_orders");
    const names = BACKUP_TABLES.map((t) => t.table).join(",");
    for (const secret of ["exchange_secrets", "trade_keys", "telegram_link_codes", "whatsapp_codes"]) expect(names).not.toContain(secret);
  });

  it("conserva solo las últimas 8 copias y borra las más viejas", async () => {
    const folders: Record<string, string[]> = {};
    for (let d = 1; d <= 9; d++) folders[`2026-09-${String(d).padStart(2, "0")}`] = ["trades.json.gz"];
    const { client, removed } = fakeSupabase({ trades: [{ id: "a" }] }, folders);
    const r = await runBackup(client, Date.parse("2026-10-17T12:00:00Z"), [{ table: "trades", order: ["id"] }]);
    // quedan 9 viejas + la de hoy = 10 → se borran las 2 más viejas
    expect(r.pruned).toEqual(["2026-09-01", "2026-09-02"]);
    expect(removed).toEqual(["2026-09-01/trades.json.gz", "2026-09-02/trades.json.gz"]);
  });
});
