// Base de datos falsa en memoria con la parte de la API de supabase-js que usan las funciones del servidor.
// Se usa en las pruebas en lugar de "npm:@supabase/supabase-js@2" (ver vitest.config.ts).

type Row = Record<string, any>;

export const db: { tables: Record<string, Row[]>; users: Record<string, { id: string }> } = { tables: {}, users: {} };

/** Deja la base vacía con las tablas indicadas (y un usuario "good" → u1). */
export function resetDb(tables: Record<string, Row[]> = {}) {
  db.tables = { profiles: [], trades: [], device_tokens: [], ...tables };
  db.users = { good: { id: "u1" } };
  seq = 0;
}

let seq = 0;

class Query {
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private filters: Array<(r: Row) => boolean> = [];
  private rows: Row[] = [];
  private opts: Record<string, any> = {};
  private vals: Row = {};
  private one: "maybe" | "single" | null = null;
  private returning = false;
  private head = false;
  private countMode = false;
  private orderBy: { col: string; asc: boolean } | null = null;
  private max: number | null = null;

  constructor(private table: string) {
    if (!db.tables[table]) db.tables[table] = [];
  }

  select(_cols?: string, opts: { count?: string; head?: boolean } = {}) {
    if (this.op !== "select") this.returning = true;
    if (opts.count) this.countMode = true;
    if (opts.head) this.head = true;
    return this;
  }
  insert(rows: Row | Row[]) { this.op = "insert"; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows: Row | Row[], opts: Record<string, any> = {}) { this.op = "upsert"; this.rows = Array.isArray(rows) ? rows : [rows]; this.opts = opts; return this; }
  update(vals: Row) { this.op = "update"; this.vals = vals; return this; }
  delete() { this.op = "delete"; return this; }
  eq(k: string, v: any) { this.filters.push((r) => r[k] === v); return this; }
  neq(k: string, v: any) { this.filters.push((r) => r[k] !== v); return this; }
  gte(k: string, v: any) { this.filters.push((r) => r[k] != null && r[k] >= v); return this; }
  lt(k: string, v: any) { this.filters.push((r) => r[k] != null && r[k] < v); return this; }
  is(k: string, v: any) { this.filters.push((r) => (r[k] ?? null) === v); return this; }
  in(k: string, vs: any[]) { this.filters.push((r) => vs.includes(r[k])); return this; }
  order(col: string, o: { ascending?: boolean } = {}) { this.orderBy = { col, asc: o.ascending !== false }; return this; }
  limit(n: number) { this.max = n; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  single() { this.one = "single"; return this; }
  then(res: (v: any) => any, rej?: (e: any) => any) { return Promise.resolve(this.run()).then(res, rej); }

  private match(r: Row) { return this.filters.every((f) => f(r)); }
  private withDefaults(row: Row): Row {
    return { id: row.id ?? `id${++seq}`, created_at: row.created_at ?? new Date().toISOString(), ...row };
  }

  private run() {
    const tbl = db.tables[this.table];
    let out: Row[] = [];
    if (this.op === "select") {
      out = tbl.filter((r) => this.match(r));
    } else if (this.op === "insert") {
      for (const row of this.rows) {
        const n = this.withDefaults(row);
        tbl.push(n);
        out.push(n);
      }
    } else if (this.op === "update") {
      out = tbl.filter((r) => this.match(r));
      out.forEach((r) => Object.assign(r, this.vals));
    } else if (this.op === "delete") {
      out = tbl.filter((r) => this.match(r));
      db.tables[this.table] = tbl.filter((r) => !out.includes(r));
    } else if (this.op === "upsert") {
      const keys = String(this.opts.onConflict ?? "id").split(",");
      for (const row of this.rows) {
        const ex = tbl.find((r) => keys.every((k) => r[k] !== undefined && r[k] === row[k]));
        if (ex) {
          if (!this.opts.ignoreDuplicates) { Object.assign(ex, row); out.push(ex); }
        } else {
          const n = this.withDefaults(row);
          tbl.push(n);
          out.push(n);
        }
      }
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
    }
    if (this.max != null) out = out.slice(0, this.max);
    if (this.head) return { data: null, count: out.length, error: null };
    const data = this.one ? (out[0] ?? null) : out;
    const wants = this.op === "select" || this.returning || this.one;
    return { data: wants ? data : null, count: this.countMode ? out.length : null, error: null };
  }
}

export const createClient = () => ({
  from: (t: string) => new Query(t),
  auth: { getUser: async (tok: string) => ({ data: { user: db.users[tok] ?? null } }) },
});
