"""Da la bienvenida a nuevos miembros, mencionándolos, con las reglas."""
import time

from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import ContextTypes, MessageHandler, filters

from utils import textos

# user_id -> momento de ingreso; lo usa el antispam
INGRESOS: dict[int, float] = {}


async def dar_bienvenida(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    for u in update.message.new_chat_members:
        if u.is_bot:
            continue
        INGRESOS[u.id] = time.time()
        texto = textos.BIENVENIDA.format(mencion=u.mention_html(), reglas=textos.REGLAS)
        await update.message.reply_text(textos.con_aviso(texto), parse_mode=ParseMode.HTML)


def handler():
    return MessageHandler(filters.StatusUpdate.NEW_CHAT_MEMBERS, dar_bienvenida)
