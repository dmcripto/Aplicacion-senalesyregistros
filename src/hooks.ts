import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { fetchTrades, rowToTrade } from "./tradesApi";
import type { Trade } from "./lib";

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

  return { trades, loading };
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useInView<T extends HTMLElement>(threshold = 0.18) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

/** Anima un número desde su valor previo hasta el nuevo (ease-out). */
export function useCountUp(value: number, duration = 800) {
  const [disp, setDisp] = useState(0);
  const prevRef = useRef(0);
  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = value;
    if (from === to) {
      setDisp(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setDisp(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return disp;
}

export function useFlashId() {
  const [flashId, setFlashId] = useState<string | null>(null);
  const timer = useRef<number>(0);
  const flash = useCallback((id: string) => {
    setFlashId(null);
    window.clearTimeout(timer.current);
    requestAnimationFrame(() => setFlashId(id));
    timer.current = window.setTimeout(() => setFlashId(null), 1700);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [flashId, flash] as const;
}
