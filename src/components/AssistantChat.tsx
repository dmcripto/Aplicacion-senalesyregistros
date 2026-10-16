import { useEffect, useRef, useState } from "react";
import { ASSISTANT_MAX_CHARS, assistantProblem, assistantSuggestions, parseChatText, t } from "../lib";
import type { ChatSpan } from "../lib";
import type { AssistantMessage } from "../lib";
import { askAssistant } from "../tradesApi";
import { OPEN_ASSISTANT_EVENT } from "../nav";
import { ShieldLogo } from "../ui";
import ChatText from "./ChatText";
import { ASSISTANT_USED_EVENT, ASSISTANT_USED_KEY } from "./GettingStarted";

const Spans = ({ spans }: { spans: ChatSpan[] }) => (
  <>
    {spans.map((x, i) =>
      x.bold ? (
        <strong key={i} className="font-bold text-snow">
          {x.text}
        </strong>
      ) : x.code ? (
        <code key={i} className="rounded bg-line/60 px-1 py-px text-[11.5px] text-gold">
          {x.text}
        </code>
      ) : (
        <span key={i}>{x.text}</span>
      ),
    )}
  </>
);

/** La respuesta de la IA con párrafos, listas y negritas (sin HTML). */
function ChatText({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {parseChatText(text).map((b, i) =>
        b.type === "p" ? (
          <p key={i}>
            <Spans spans={b.spans} />
          </p>
        ) : b.type === "ul" ? (
          <ul key={i} className="space-y-1">
            {b.items.map((it, j) => (
              <li key={j} className="flex gap-2">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
                <span className="min-w-0">
                  <Spans spans={it} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="space-y-1">
            {b.items.map((it, j) => (
              <li key={j} className="flex gap-2">
                <span className="num mt-px w-4 shrink-0 text-right text-[11.5px] font-bold text-gold">{j + 1}.</span>
                <span className="min-w-0">
                  <Spans spans={it} />
                </span>
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

/** Asistente con IA: botón flotante + chat que responde dudas de la plataforma y explica tus propios datos. */
export default function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // El botón «Ayuda» de la barra de arriba abre este mismo chat.
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_ASSISTANT_EVENT, on);
    return () => window.removeEventListener(OPEN_ASSISTANT_EVENT, on);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy, open]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    const next: AssistantMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setProblem(null);
    setBusy(true);
    try {
      const r = await askAssistant(next);
      if (r.ok) {
        setMessages([...next, { role: "assistant", content: r.text }]);
        try {
          localStorage.setItem(ASSISTANT_USED_KEY, "1");
        } catch {
          /* sin almacenamiento */
        }
        window.dispatchEvent(new Event(ASSISTANT_USED_EVENT)); // tilda el paso de la guía de inicio
      }
      else setProblem(assistantProblem(r));
    } catch {
      setProblem(assistantProblem({ ok: false, reason: "unavailable" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={t("Asistente VELTRIX")}
          className="fixed bottom-5 right-5 z-[80] flex items-center gap-2 rounded-full border border-gold/50 bg-ink/95 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-gold shadow-lg backdrop-blur transition-all hover:bg-gold/10"
        >
          <ShieldLogo className="h-6 w-6" />
          {t("Ayuda")}
        </button>
      )}
      {open && (
        <div className="fixed inset-x-3 bottom-3 z-[85] flex max-h-[min(80vh,640px)] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[400px]">
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2.5">
              <ShieldLogo className="h-9 w-9 shrink-0" />
              <div>
                <p className="text-[13px] font-bold text-snow">{t("Asistente VELTRIX")}</p>
                <p className="text-[11px] text-dim">{t("Preguntame sobre la plataforma o tus resultados")}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-fog">
              {messages.length > 0 && (
                <button onClick={() => { setMessages([]); setProblem(null); }} className="hover:text-snow">
                  {t("Nueva conversación")}
                </button>
              )}
              <button onClick={() => setOpen(false)} aria-label={t("Cerrar")} className="text-base leading-none hover:text-snow">
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <>
                <ShieldLogo className="mx-auto h-16 w-16" />
                <p className="text-[12.5px] leading-relaxed text-fog">{t("Hola, soy el asistente de VELTRIX. Puedo explicarte cómo funciona la plataforma y tus propios resultados. No doy señales ni consejos de inversión.")}</p>
                <div className="flex flex-wrap gap-2">
                  {assistantSuggestions().map((q) => (
                    <button key={q} onClick={() => void send(q)} className="rounded-full border border-line px-3 py-1.5 text-left text-[11.5px] text-snow transition-colors hover:border-gold/60 hover:text-gold">
                      {q}
                    </button>
                  ))}
                </div>
              </>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex items-start justify-start gap-2"}>
                {m.role === "assistant" && <ShieldLogo className="mt-0.5 h-6 w-6 shrink-0" />}
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] whitespace-pre-line rounded-lg bg-gold/15 px-3 py-2 text-[12.5px] leading-relaxed text-snow"
                      : "max-w-[92%] rounded-lg border border-line bg-ink/50 px-3 py-2 text-[12.5px] leading-relaxed text-snow"
                  }
                >
                  {m.role === "assistant" ? <ChatText text={m.content} /> : m.content}
                </div>
              </div>
            ))}
            {busy && (
              <p className="flex items-center gap-2 text-[12px] text-dim">
                <ShieldLogo className="h-6 w-6 animate-pulse" />
                {t("Pensando…")}
              </p>
            )}
            {problem && <p className="rounded-md border border-gold/40 bg-golddeep/30 px-3 py-2 text-[12px] leading-relaxed text-gold">{problem}</p>}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="border-t border-line p-3"
          >
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={ASSISTANT_MAX_CHARS}
                placeholder={t("Escribí tu pregunta…")}
                className="min-w-0 flex-1 rounded-md border border-line bg-ink/60 px-3 py-2 text-[13px] text-snow outline-none focus:border-gold/60"
              />
              <button type="submit" disabled={busy || !input.trim()} className="rounded-md bg-gold px-3.5 py-2 text-[12px] font-bold uppercase tracking-wider text-ink disabled:opacity-50">
                {t("Enviar")}
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-snug text-dim">{t("Respuestas generadas con IA: pueden tener errores y no son un consejo de inversión. Para contestar se envían tu pregunta y estadísticas calculadas de tu diario (nunca claves ni datos personales). No pegues claves API acá.")}</p>
          </form>
        </div>
      )}
    </>
  );
}
