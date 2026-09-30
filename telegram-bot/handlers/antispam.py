"""Antispam: borra enlaces de usuarios nuevos y mensajes repetidos."""
import time
from collections import defaultdict, deque

from telegram import Update
from telegram.ext import ContextTypes, MessageHandler, filters

import config
from handlers.bienvenida import INGRESOS
from utils import confianza, logger_mod

_recientes: dict[tuple[int, int], deque] = defaultdict(deque)


def _tiene_enlace(msg) -> bool:
    ents = list(msg.entities or []) + list(msg.caption_entities or [])
    return any(e.type in ("url", "text_link") for e in ents)


def _es_nuevo(user_id: int) -> bool:
    ingreso = INGRESOS.get(user_id)
    return ingreso is not None and time.time() - ingreso < config.HORAS_USUARIO_NUEVO * 3600


async def moderar(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    msg, user, chat = update.effective_message, update.effective_user, update.effective_chat
    if not msg or not user or user.is_bot:
        return
    if await confianza.es_de_confianza(chat, user.id):
        return

    motivo = None
    if _tiene_enlace(msg) and _es_nuevo(user.id):
        motivo = "enlace de usuario nuevo"
    else:
        texto = (msg.text or msg.caption or "").strip().lower()
        if texto:
            ahora = time.time()
            cola = _recientes[(chat.id, user.id)]
            cola.append((ahora, texto))
            while cola and ahora - cola[0][0] > config.REPETIDOS_VENTANA_SEG:
                cola.popleft()
            if sum(1 for _, t in cola if t == texto) >= config.REPETIDOS_MAX:
                motivo = "mensaje repetido"

    if motivo:
        try:
            await msg.delete()
            logger_mod.registrar("mensaje_borrado", chat.id, user.id, motivo)
        except Exception as e:
            logger_mod.registrar("error_al_borrar", chat.id, user.id, type(e).__name__)


def handler():
    return MessageHandler(
        (filters.TEXT | filters.CAPTION) & ~filters.COMMAND & filters.ChatType.GROUPS,
        moderar,
    )
