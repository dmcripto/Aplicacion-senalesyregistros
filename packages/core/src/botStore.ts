// ─── VELTRIX · Estado compartido del bot automático ─────────────────────────
// «Bot automático» y «Estrategia sugerida» están en pantallas distintas pero muestran lo mismo: si el bot
// está encendido y qué reglas tiene aplicadas. Este estado vive acá, una sola vez, para web y app.
// No depende de React: cada pantalla lo escucha con useSyncExternalStore.

import type { BotAction, BotSettings } from "./trading";
import { DEFAULT_BOT } from "./trading";
import { actionId } from "./strategy";

export interface BotLoaded extends BotSettings {
  /** false si el servidor todavía no tiene la columna de reglas (falta correr el SQL nuevo). */
  rulesSupported: boolean;
}

export interface BotApi {
  /** Lee los ajustes de la persona; tira un error si el servidor todavía no tiene la tabla del bot. */
  load(): Promise<BotLoaded>;
  save(s: BotSettings, rulesSupported: boolean): Promise<void>;
}

export interface BotState {
  /** "missing" = el servidor todavía no tiene el bot: no se muestra nada. */
  status: "idle" | "loading" | "ready" | "missing";
  settings: BotSettings;
  rulesSupported: boolean;
}

export function createBotStore(api: BotApi) {
  let state: BotState = { status: "idle", settings: DEFAULT_BOT, rulesSupported: false };
  const listeners = new Set<() => void>();
  const set = (next: BotState) => {
    state = next;
    listeners.forEach((l) => l());
  };

  const store = {
    getState: () => state,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    /** Vuelve al estado de fábrica (al cerrar sesión o cambiar de cuenta, para no mostrar lo de otra persona). */
    reset() {
      set({ status: "idle", settings: DEFAULT_BOT, rulesSupported: false });
    },
    /** Carga una sola vez (las demás llamadas esperan a la primera). */
    async load(force = false) {
      if (!force && state.status !== "idle") return;
      set({ ...state, status: "loading" });
      try {
        const { rulesSupported, ...settings } = await api.load();
        set({ status: "ready", settings, rulesSupported });
      } catch {
        set({ ...state, status: "missing" });
      }
    },
    /** Cambia ajustes y los guarda; si falla, vuelve atrás y tira el error. */
    async update(patch: Partial<BotSettings>) {
      const prev = state;
      const next = { ...state.settings, ...patch };
      set({ ...state, settings: next });
      try {
        await api.save(next, state.rulesSupported);
      } catch (e) {
        set(prev);
        throw e;
      }
    },
    isApplied: (id: string) => state.settings.rules.some((r) => actionId(r) === id),
    /** Aplica una regla de la estrategia sugerida (no repite; el tope diario y el de pérdidas se reemplazan). */
    apply(action: BotAction) {
      const opposite = (r: BotAction) => "dim" in r && "dim" in action && r.dim === action.dim && r.key === action.key; // «no operar X» y «solo X» se pisan
      const rest = state.settings.rules.filter((r) => actionId(r) !== actionId(action) && !opposite(r) && (r.op !== action.op || "dim" in action));
      return store.update({ rules: [...rest, action].slice(-20) });
    },
    remove(id: string) {
      return store.update({ rules: state.settings.rules.filter((r) => actionId(r) !== id) });
    },
  };
  return store;
}

export type BotStore = ReturnType<typeof createBotStore>;
