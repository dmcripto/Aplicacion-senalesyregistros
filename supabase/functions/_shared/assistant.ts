// ─── VELTRIX · Asistente con IA ─────────────────────────────────────────────
// Un chat que responde dudas sobre la plataforma y explica los propios datos de la persona.
// Los números los calcula el código (los mismos que usan el coach y el resumen del bot); la IA solo los explica.
// Solo lee: no puede operar, cambiar ajustes ni tocar nada. No da señales ni consejos de inversión.
// Sin dependencias de Deno ni de Node, para poder probarlo en local.
import { aiErrorDetail, computeFacts } from "./coach.ts";
import type { CoachTrade } from "./coach.ts";
import { computeBotFacts } from "./botCoach.ts";
import type { BotTrade } from "./botCoach.ts";

export const ASSISTANT_MAX_PER_DAY = 40;
export const ASSISTANT_MAX_TURNS = 10; // mensajes que se mandan a la IA (los más recientes)
export const ASSISTANT_MAX_CHARS = 1000; // largo máximo de cada mensaje
export const ASSISTANT_MAX_TOKENS = 700;

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

/** Deja solo mensajes válidos, recorta el largo y se asegura de que empiece y termine con la persona hablando. null si no hay nada que contestar. */
export function cleanAssistantMessages(raw: unknown): AssistantMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AssistantMessage[] = [];
  for (const m of raw) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.trim().slice(0, ASSISTANT_MAX_CHARS);
    if (!text) continue;
    // Los roles tienen que alternar: si se repite el mismo, se queda con el último.
    if (out.length && out[out.length - 1].role === role) out[out.length - 1] = { role, content: text };
    else out.push({ role, content: text });
  }
  const recent = out.slice(-ASSISTANT_MAX_TURNS);
  while (recent.length && recent[0].role !== "user") recent.shift();
  if (!recent.length || recent[recent.length - 1].role !== "user") return null;
  return recent;
}

/** Lo que la IA sabe de VELTRIX. Si algo cambia en la plataforma, se actualiza acá. */
export const ASSISTANT_HELP = `QUÉ ES VELTRIX
Un diario de trading de criptomonedas con señales y un bot automático. Funciona en la web (www.veltrix-trading.com.ar) y en una app Android. Es una herramienta de práctica y estudio: no es asesoramiento financiero ni garantiza ganancias.

SECCIONES DE LA WEB (menú superior)
- Inicio: resumen y guía para empezar.
- Diario: lista de operaciones (abiertas y cerradas), estadísticas, resultado en R, gráfico de equity, exportar a CSV. Se cargan a mano, desde alertas de TradingView o importándolas de un exchange.
- Análisis: estadísticas por etiqueta, resumen mensual y el coach con IA.
- Herramientas: calculadora de riesgo (cuánto arriesgar y qué tamaño de posición).
- Gráfico: velas con indicadores y los niveles de las señales abiertas; alertas propias de precio, RSI y EMA con aviso por notificación y Telegram.
- Mapa de liquidaciones: dónde se concentran posibles liquidaciones por nivel de apalancamiento.
- Bot: bot automático simulado, laboratorio de pruebas y bot con dinero real.
- Conexiones: exchanges y Telegram.
- Descargar: la app de Android.
- Cuenta: sesión, verificación en dos pasos (2FA), límites diarios, capital y riesgo por operación.

CONCEPTOS
- R: el resultado medido en unidades de riesgo. Si arriesgás 10 y ganás 20, son +2R; si perdés todo lo arriesgado, −1R.
- TP: objetivo (take profit). SL: stop (stop loss). Entrada: precio de entrada. R:R: cuánto se busca ganar por cada unidad arriesgada.
- Una operación puede tener varios objetivos (TP1, TP2…).

CONECTAR UN EXCHANGE (Conexiones)
Exchanges: Binance, Bybit, Bitunix, Gate, Bitget, OKX, KuCoin y BingX. Se conectan con una clave API de SOLO LECTURA (sin permiso de retirar ni de operar) para importar las operaciones al diario. OKX, KuCoin y Bitget piden además una frase de acceso (passphrase). Las claves se guardan cifradas. Al conectar, se pide el capital para calcular el resultado en dinero. Si algo falla al conectar, lo más común es: copiar la clave con un espacio de más, no tener activada la lectura, o la restricción de IP.

BOT AUTOMÁTICO (sección Bot)
- Simulado: el bot busca entradas y abre operaciones simuladas en el Diario (con la etiqueta «Bot simulado»). No gasta dinero. Cada persona elige un perfil y el bot lo aplica en su cuenta.
- Perfiles: Conservador (menos señales), Equilibrado (el punto medio, recomendado para empezar), Dinámico, Intensivo, Máxima actividad (los más activos, con más comisiones), Lento (velas de 4 horas) y Lento con objetivo amplio. Más operaciones no significa más ganancia: cada operación paga comisiones.
- Laboratorio: prueba variantes con un año de historia, en dos mitades. Sirve para comparar, no promete resultados futuros.
- Pruebas paralelas: «Entradas filtradas» (etiqueta «Filtro 4h») y «Corredor» corren aparte, solo simuladas, sin afectar el perfil elegido ni el bot real.
- Resumen semanal del bot con IA: explica cómo le fue en los últimos 7 días (pide al menos 5 operaciones cerradas).
- Bot con dinero real: opera de verdad en el exchange de la persona con una clave API que sí tiene permiso de operar, con un tope de tamaño y de posiciones abiertas simultáneas (máximo 3), apalancamiento configurable y las operaciones marcadas con la etiqueta «Bot real». Solo ejecuta las señales que el bot abrió en simulado con el perfil elegido. Si una moneda no está en el exchange de la persona, no se opera y se avisa. Es opcional y es la persona quien lo activa y puede apagarlo cuando quiera. Se puede perder dinero.
- Pausa por datos económicos importantes (opcional): el bot espera antes y después de noticias de alto impacto.
- Una operación real y su copia simulada pueden terminar distinto: cada exchange tiene precios, comisiones y velas algo diferentes.

SEÑALES Y AVISOS
- Las alertas de TradingView llegan por webhook y se cargan solas al Diario con aviso a la app y a Telegram. Formato del mensaje: DMCRIPTO|SÍMBOLO|COMPRA o VENTA|ENTRADA|TP|SL.
- «Señales para ejecutar» muestra las señales abiertas listas para usar con su cálculo de riesgo.
- Telegram: se vincula desde Conexiones; manda avisos, un resumen diario a las 21:00 de la zona horaria de la persona y también hay comunidad con comandos.
- Las notificaciones push llegan a la app de Android.

COACH CON IA
Analiza el diario de los últimos 45 días (al menos 10 operaciones cerradas): horarios, activos, qué pasa después de una pérdida, notas. Describe hábitos; no da señales.

CUENTA Y SEGURIDAD
- 2FA con Google Authenticator (en Cuenta).
- Límites diarios propios (pérdida máxima y cantidad de operaciones) para cuidar la disciplina.
- Idioma español o inglés.

APP ANDROID
Se descarga desde la sección Descargar. Si queda una versión vieja instalada, hay que volver a descargar e instalar la nueva (la app avisa cuando hay una actualización).`;

export function buildAssistantSystem(facts: unknown, lang: "es" | "en"): string {
  const en = lang === "en";
  const rules = en
    ? `You are the assistant inside VELTRIX, a crypto trading journal with an automatic bot. Answer in the language the person writes in (default English).

Rules:
- Use the HELP section for how the platform works. If the answer is not there, say you are not sure and suggest asking in the VELTRIX community (Telegram). Never invent features, buttons, prices or settings.
- For questions about the person's own results, use ONLY the numbers in YOUR DATA. Never invent, estimate or recalculate figures. If the data is missing or there are too few trades, say so.
- Never give trade signals, price predictions or investment advice, and never tell the person to buy, sell, enter, change leverage or risk more. You can explain what happened, how a setting works and the risks. If asked "should I buy X?", say you can't recommend trades and explain what they can check instead (their plan, risk calculator, journal).
- You can only read and explain: you cannot place orders, change settings or access anything else. Never ask for or accept API keys, passwords or secrets; if someone pastes one, tell them to delete it and, if it is an API key, to revoke it.
- Stay on topic (VELTRIX, trading journaling, risk management, how trading concepts work). Politely decline anything else.
- Be warm, direct and brief: 120 words maximum unless the person asks for detail. Short bullets are fine. No emojis except at most one.`
    : `Sos el asistente dentro de VELTRIX, un diario de trading de criptomonedas con un bot automático. Respondé en el idioma en que escribe la persona (por defecto, español rioplatense con vos).

Reglas:
- Para saber cómo funciona la plataforma usá la sección AYUDA. Si la respuesta no está ahí, decí que no estás seguro y sugerí preguntar en la comunidad de VELTRIX (Telegram). Nunca inventes funciones, botones, precios ni ajustes.
- Para preguntas sobre los resultados de la persona usá SOLO los números de TUS DATOS. No inventes, estimes ni recalcules cifras. Si faltan datos o hay muy pocas operaciones, decilo.
- Nunca des señales, predicciones de precio ni consejos de inversión, y nunca le digas a la persona que compre, venda, entre, cambie el apalancamiento o arriesgue más. Podés explicar qué pasó, cómo funciona un ajuste y cuáles son los riesgos. Si pregunta «¿compro X?», decí que no podés recomendar operaciones y explicá qué puede revisar (su plan, la calculadora de riesgo, su diario).
- Solo leés y explicás: no podés poner órdenes, cambiar ajustes ni acceder a otra cosa. Nunca pidas ni aceptes claves API, contraseñas o secretos; si alguien pega una, decile que la borre y, si es una clave API, que la revoque en su exchange.
- Mantenete en el tema (VELTRIX, el diario de trading, la gestión del riesgo, cómo funcionan los conceptos de trading). Rechazá con amabilidad todo lo demás.
- Sé cálido, directo y breve: 120 palabras como máximo salvo que pidan detalle. Viñetas cortas está bien. Sin emojis salvo uno como máximo.`;
  return `${rules}\n\n${en ? "HELP" : "AYUDA"}:\n${ASSISTANT_HELP}\n\n${en ? "YOUR DATA (JSON, calculated by code from the person's journal)" : "TUS DATOS (JSON, calculados por código a partir del diario de la persona)"}:\n${JSON.stringify(facts)}`;
}

// ─── Respuesta con límites ──────────────────────────────────────────────────

export type AssistantResult =
  | { ok: true; text: string; remaining: number }
  | { ok: false; reason: "bad_input" | "limit" | "refused" | "unavailable" | "no_key"; detail?: string };

export interface AssistantDeps {
  supabase: any;
  /** Llama a la IA con la conversación y devuelve el texto (o null si se negó). Lanza un error si el servicio falla. */
  ask: (system: string, messages: AssistantMessage[]) => Promise<string | null>;
  hasKey: boolean;
}

export async function assistantReply(deps: AssistantDeps, userId: string, rawMessages: unknown, now = Date.now()): Promise<AssistantResult> {
  const messages = cleanAssistantMessages(rawMessages);
  if (!messages) return { ok: false, reason: "bad_input" };
  if (!deps.hasKey) return { ok: false, reason: "no_key" };
  const { supabase } = deps;

  const dayAgo = new Date(now - 86_400_000).toISOString();
  const { data: used } = await supabase.from("assistant_log").select("created_at").eq("user_id", userId).gte("created_at", dayAgo).limit(ASSISTANT_MAX_PER_DAY + 1);
  const count = (used ?? []).length;
  if (count >= ASSISTANT_MAX_PER_DAY) return { ok: false, reason: "limit" };

  const { data: profile } = await supabase.from("profiles").select("timezone,lang,daily_loss_limit,daily_trade_limit").eq("id", userId).maybeSingle();
  const prof = (profile ?? {}) as { timezone?: string | null; lang?: string | null; daily_loss_limit?: number | null; daily_trade_limit?: number | null };
  const lang: "es" | "en" = prof.lang === "en" ? "en" : "es";
  const since = new Date(now - 52 * 86_400_000).toISOString();
  const { data: trades } = await supabase
    .from("trades")
    .select("symbol,direction,entry,tp,sl,date,outcome,exit,closed_at,notes,tags,source")
    .eq("user_id", userId)
    .gte("date", since)
    .limit(2000);
  const list = (trades ?? []) as Array<CoachTrade & BotTrade>;
  const closed = list.filter((t) => t.outcome !== "ABIERTA").length;
  const facts = {
    journal: { openTrades: list.length - closed, closedLast52Days: closed, dailyLimits: { maxLoss: prof.daily_loss_limit ?? null, maxTrades: prof.daily_trade_limit ?? null } },
    habits: computeFacts(list, prof, now), // null si hay menos de 10 cerradas
    botLast7Days: computeBotFacts(list, now), // null si hay menos de 5 cerradas del bot
  };

  let text: string | null;
  try {
    text = await deps.ask(buildAssistantSystem(facts, lang), messages);
  } catch (e) {
    console.error("assistant:", (e as { status?: number })?.status ?? "", e instanceof Error ? e.message : e);
    return { ok: false, reason: "unavailable", detail: aiErrorDetail(e) };
  }
  if (!text || !text.trim()) return { ok: false, reason: "refused" };

  await supabase.from("assistant_log").insert({ user_id: userId, created_at: new Date(now).toISOString() });
  // Limpieza: se borra lo de más de dos días de esta persona.
  await supabase.from("assistant_log").delete().eq("user_id", userId).lt("created_at", new Date(now - 2 * 86_400_000).toISOString());
  return { ok: true, text: text.trim(), remaining: Math.max(0, ASSISTANT_MAX_PER_DAY - count - 1) };
}
