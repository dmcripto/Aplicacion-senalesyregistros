// Estado compartido del bot automático para la app (ver packages/core/src/botStore.ts).
import { useEffect, useSyncExternalStore } from "react";
import { createBotStore } from "@dmcripto/core";
import { fetchBotSettings, saveBotSettings } from "./tradesApi";
import { supabase } from "./supabaseClient";

const userId = async () => (await supabase.auth.getSession()).data.session?.user.id ?? null;

export const botStore = createBotStore({
  async load() {
    const id = await userId();
    if (!id) throw new Error("sin sesión");
    return fetchBotSettings(id);
  },
  async save(s, caps) {
    const id = await userId();
    if (!id) throw new Error("sin sesión");
    await saveBotSettings(id, s, caps);
  },
});

// Si cambia la persona (cierra sesión o entra otra cuenta) se descarta lo cargado.
let lastUser: string | null = null;
supabase.auth.onAuthStateChange((_event, session) => {
  const id = session?.user.id ?? null;
  if (id !== lastUser) {
    lastUser = id;
    botStore.reset();
  }
});

/** El estado del bot, siempre actualizado. Carga una vez la primera vez que se usa. */
export function useBot() {
  const state = useSyncExternalStore(botStore.subscribe, botStore.getState, botStore.getState);
  useEffect(() => {
    if (state.status === "idle") void botStore.load();
  }, [state.status]);
  return { ...state, store: botStore };
}
