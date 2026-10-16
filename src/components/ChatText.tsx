import { parseChatText } from "../lib";
import type { ChatSpan } from "../lib";

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
export default function ChatText({ text }: { text: string }) {
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
