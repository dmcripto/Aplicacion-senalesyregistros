import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { fetchTrades, rowToTrade } from "./tradesApi";
import { binanceSymbol } from "./lib";
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

  // El aviso de borrado en tiempo real no llega cuando la suscripción filtra por usuario, así que la lista se actualiza acá mismo.
  const removeLocal = useCallback((ids: string[] | "all") => setTrades((prev) => (ids === "all" ? [] : prev.filter((x) => !ids.includes(x.id)))), []);
  const restoreLocal = useCallback(
    (t: Trade) => setTrades((prev) => (prev.some((x) => x.id === t.id) ? prev : [t, ...prev].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()))),
    [],
  );

  return { trades, loading, removeLocal, restoreLocal };
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
  // Ref con función: si el elemento aparece o cambia después (por ejemplo, cuando llegan los datos), se vuelve a observar.
  const [el, setEl] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!el || inView) return;
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
  }, [el, threshold, inView]);
  return [setEl, inView] as const;
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

/**
 * Precio actual de las señales abiertas (criptomonedas, datos públicos de Binance), para mostrar qué tan cerca están del TP o del SL.
 * Se actualiza cada 20 s y solo con la pestaña visible. Si no hay conexión o el activo no existe, simplemente no hay barra.
 */
export function usePrices(trades: Trade[]) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const key = trades
    .filter((t) => t.outcome === "ABIERTA")
    .map((t) => t.id + "=" + t.symbol)
    .sort()
    .join("|");

  useEffect(() => {
    const open = key ? key.split("|").map((x) => x.split("=")) : [];
    const targets = new Map<string, { symbol: string; perp: boolean }>();
    for (const [, sym] of open) {
      const b = binanceSymbol(sym);
      if (b) targets.set(sym, b);
    }
    if (!targets.size) {
      setPrices({});
      return;
    }
    let stop = false;
    const load = async () => {
      if (document.hidden) return;
      const bySymbol: Record<string, number> = {};
      await Promise.all(
        [...targets.entries()].slice(0, 12).map(async ([raw, b]) => {
          try {
            const base = b.perp ? "https://fapi.binance.com/fapi/v1" : "https://api.binance.com/api/v3";
            const res = await fetch(`${base}/ticker/price?symbol=${b.symbol}`, { signal: AbortSignal.timeout(6000) });
            if (!res.ok) return;
            const price = Number((await res.json()).price);
            if (price > 0) bySymbol[raw] = price;
          } catch {
            /* sin precio: no se muestra la barra */
          }
        }),
      );
      if (stop) return;
      const byId: Record<string, number> = {};
      for (const [id, sym] of open) if (bySymbol[sym] != null) byId[id] = bySymbol[sym];
      setPrices(byId);
    };
    void load();
    const timer = window.setInterval(load, 20_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [key]);

  return prices;
}

/** Avisa cuando una señal pasa de abierta a TP mientras mirás la pantalla (a mano o por el cierre automático). */
export function useTpCelebration(trades: Trade[]) {
  const [hit, setHit] = useState<{ id: string; symbol: string; token: number } | null>(null);
  const prev = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const now = new Map(trades.map((t) => [t.id, t.outcome]));
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    for (const t of trades) {
      if (t.outcome === "TP" && before.get(t.id) === "ABIERTA") {
        setHit({ id: t.id, symbol: t.symbol, token: Date.now() });
        break;
      }
    }
  }, [trades]);
  const clear = useCallback(() => setHit(null), []);
  return [hit, clear] as const;
}
