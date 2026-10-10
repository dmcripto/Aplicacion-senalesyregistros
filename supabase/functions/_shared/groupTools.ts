// ─── VELTRIX · Herramientas del bot de Telegram dentro de los grupos ────────
// Enlaces de invitación por persona (con recuento de quién entró), fijar mensajes (y soltar el anterior) y filtro de enlaces
// de recién llegados. Usan los permisos de administrador del bot: «Invitar con un enlace», «Fijar mensajes» y «Eliminar mensajes».
// Nunca lanzan errores: si al bot le falta un permiso, simplemente no se hace y el resto sigue.

import { tgApi } from "./telegram.ts";

export const NEW_MEMBER_MS = 24 * 3_600_000; // quien entró hace menos de esto es «recién llegado»

/** Nombre del enlace de invitación (Telegram permite hasta 32 caracteres). */
export const inviteName = (from: { first_name?: string; username?: string; id?: number }) => `VELTRIX · ${from.first_name || from.username || from.id || ""}`.slice(0, 32);

/** ¿El mensaje trae un enlace? Mira las entidades de Telegram y, por las dudas, el texto. */
export function hasLink(msg: { text?: string; caption?: string; entities?: Array<{ type: string }>; caption_entities?: Array<{ type: string }> }): boolean {
  const ents = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])];
  if (ents.some((e) => e.type === "url" || e.type === "text_link")) return true;
  return /(https?:\/\/|www\.|\bt\.me\/|\btelegram\.me\/)/i.test(`${msg.text ?? ""} ${msg.caption ?? ""}`);
}

/** El enlace de invitación propio de esa persona en ese grupo (se crea una vez y se guarda). Null si no se pudo. */
export async function myInvite(supabase: any, token: string, chatId: number, from: { id: number; first_name?: string; username?: string }): Promise<{ link: string; joins: number } | null> {
  try {
    const { data: row, error } = await supabase.from("group_invites").select("link, joins").eq("chat_id", chatId).eq("tg_user_id", from.id).maybeSingle();
    if (error) return null; // falta el SQL
    if (row) return { link: String(row.link), joins: Number(row.joins ?? 0) };
    const r = await tgApi(token, "createChatInviteLink", { chat_id: chatId, name: inviteName(from) });
    const link = r?.ok ? String(r.result?.invite_link ?? "") : "";
    if (!link) return null;
    await supabase.from("group_invites").insert({ chat_id: chatId, tg_user_id: from.id, tg_name: from.first_name ?? from.username ?? null, link, joins: 0 });
    return { link, joins: 0 };
  } catch {
    return null;
  }
}

/**
 * Anota que alguien entró al grupo. Con `link` (el enlace con el que entró) se le suma la entrada a quien lo creó; sin él, solo queda
 * registrada la fecha. Cada persona cuenta una sola vez por grupo. Devuelve el id de quien invitó, si se pudo saber.
 */
export async function recordJoin(supabase: any, chatId: number, tgId: number, link?: string | null, now = Date.now()): Promise<number | null> {
  try {
    const { data: prev, error } = await supabase.from("group_joins").select("invited_by").eq("chat_id", chatId).eq("tg_user_id", tgId).maybeSingle();
    if (error) return null;
    let inviter: number | null = null;
    if (link) {
      const { data: inv } = await supabase.from("group_invites").select("tg_user_id, joins").eq("chat_id", chatId).eq("link", link).maybeSingle();
      if (inv && Number(inv.tg_user_id) !== tgId) inviter = Number(inv.tg_user_id);
      if (inv && inviter != null && !(prev && prev.invited_by != null)) await supabase.from("group_invites").update({ joins: Number(inv.joins ?? 0) + 1 }).eq("chat_id", chatId).eq("tg_user_id", inviter);
    }
    if (!prev) await supabase.from("group_joins").insert({ chat_id: chatId, tg_user_id: tgId, invited_by: inviter, joined_at: new Date(now).toISOString() });
    else if (inviter != null && prev.invited_by == null) await supabase.from("group_joins").update({ invited_by: inviter }).eq("chat_id", chatId).eq("tg_user_id", tgId);
    return inviter;
  } catch {
    return null;
  }
}

/** ¿Esa persona entró al grupo hace poco? */
export async function isNewMember(supabase: any, chatId: number, tgId: number, now = Date.now()): Promise<boolean> {
  try {
    const { data } = await supabase.from("group_joins").select("joined_at").eq("chat_id", chatId).eq("tg_user_id", tgId).maybeSingle();
    return !!data && now - new Date(data.joined_at).getTime() < NEW_MEMBER_MS;
  } catch {
    return false;
  }
}

/** Fija un mensaje (sin avisar a todo el grupo) y suelta el que había fijado antes el bot, para no acumular. Devuelve si se pudo fijar. */
export async function pinReplace(token: string, chatId: number, messageId: number, prevId?: number | null): Promise<boolean> {
  try {
    if (prevId && prevId !== messageId) await tgApi(token, "unpinChatMessage", { chat_id: chatId, message_id: prevId });
    const r = await tgApi(token, "pinChatMessage", { chat_id: chatId, message_id: messageId, disable_notification: true });
    return !!r?.ok;
  } catch {
    return false;
  }
}
