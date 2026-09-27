import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Trade } from "@dmcripto/core";
import { supabase } from "./supabaseClient";
import { fetchTrades, rowToTrade } from "./tradesApi";

export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setIsRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const clearRecovery = useCallback(() => setIsRecovery(false), []);

  return { session, isRecovery, clearRecovery };
}

/** Diario de trades sincronizado con Supabase (carga inicial + Realtime). */
export function useTrades(userId: string | undefined) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    if (!userId) return;
    setRefreshing(true);
    fetchTrades()
      .then(setTrades)
      .finally(() => setRefreshing(false));
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setTrades([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchTrades()
      .then((list) => {
        if (!cancelled) setTrades(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const channel = supabase
      .channel(`trades-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trades", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const t = rowToTrade(payload.new as never);
            setTrades((prev) => (prev.some((x) => x.id === t.id) ? prev : [t, ...prev]));
          } else if (payload.eventType === "UPDATE") {
            const t = rowToTrade(payload.new as never);
            setTrades((prev) => prev.map((x) => (x.id === t.id ? t : x)));
          } else if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id: string }).id;
            setTrades((prev) => prev.filter((x) => x.id !== oldId));
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return { trades, loading, refreshing, refresh };
}
