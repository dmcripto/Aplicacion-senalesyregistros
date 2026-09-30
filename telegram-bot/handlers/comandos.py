"""Comandos: /reglas, /faq, /ayuda."""
from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import CommandHandler, ContextTypes

from utils import textos


def _responder(texto: str):
    async def _cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await update.message.reply_text(textos.con_aviso(texto), parse_mode=ParseMode.HTML)
    return _cmd


def handlers():
    return [
        CommandHandler("reglas", _responder(textos.REGLAS)),
        CommandHandler("faq", _responder(textos.FAQ)),
        CommandHandler(["ayuda", "start"], _responder(textos.AYUDA)),
    ]
