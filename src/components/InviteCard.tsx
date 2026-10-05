import { useEffect, useState } from "react";
import { inviteLink, inviteMessage, t } from "../lib";
import type { InviteInfo } from "../lib";
import { supabase } from "../supabaseClient";
import { IconClipboard } from "../ui";
import Panel from "./Panel";

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;

/** Programa de invitados: tu enlace personal y cuánta gente trajiste (solo números, nunca quiénes). */
export default function InviteCard({ notify }: { notify: Notify }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.rpc("my_invite");
      if (!alive) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row?.code) return setUnavailable(true); // la función todavía no está creada en el servidor: no se muestra nada
      setInfo({ code: String(row.code), invited: Number(row.invited) || 0, active: Number(row.active) || 0 });
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (unavailable) return null;
  const link = info ? inviteLink(info.code) : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      notify(t("¡Copiado!"));
    } catch {
      notify(t("No se pudo copiar."), "err");
    }
  };

  const share = async () => {
    if (!info) return;
    try {
      if (navigator.share) await navigator.share({ text: inviteMessage(info.code) });
      else await copy();
    } catch {
      /* la persona cerró el menú de compartir */
    }
  };

  return (
    <Panel
      id="invite"
      title={t("INVITÁ AMIGOS")}
      subtitle={t("Compartí tu enlace y mirá cuánta gente traés")}
      summary={info ? t("{n} invitados", { n: info.invited }) : undefined}
      defaultOpen={false}
    >
      <div className="space-y-3 p-5">
        <p className="text-[12px] leading-relaxed text-fog">
          {t("Cuando un amigo cree su cuenta con tu enlace (o escriba tu código al registrarse), suma como invitado tuyo.")}
        </p>

        {info ? (
          <>
            <div className="flex gap-2">
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="field num min-w-0 flex-1 text-[12px]" aria-label={t("Tu enlace")} />
              <button onClick={copy} className="flex shrink-0 items-center gap-1.5 rounded-md border border-gold/45 px-3 text-[11px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/10">
                <IconClipboard className="h-3.5 w-3.5" /> {t("Copiar")}
              </button>
            </div>
            <button
              onClick={share}
              className="w-full rounded-md bg-gold px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110"
            >
              {t("Compartir")}
            </button>
            <p className="text-[11.5px] text-fog">
              {t("Tu código")}: <b className="num tracking-[0.12em] text-snow">{info.code}</b>
            </p>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-line bg-ink/50 p-3">
                <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-dim">{t("Invitados")}</p>
                <p className="num text-xl font-bold text-snow">{info.invited}</p>
              </div>
              <div className="rounded-md border border-line bg-ink/50 p-3">
                <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-dim">{t("Activos")}</p>
                <p className="num text-xl font-bold text-bull">{info.active}</p>
              </div>
            </div>
            <p className="text-[10.5px] leading-relaxed text-dim">
              {t("Un invitado activo es el que ya cargó al menos una operación. Vos ves cuántos son, no quiénes.")}
            </p>
          </>
        ) : (
          <p className="text-[12px] text-dim">{t("Un momento…")}</p>
        )}
      </div>
    </Panel>
  );
}
