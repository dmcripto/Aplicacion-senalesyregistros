"""Punto de entrada del bot de DMCRIPTO."""
import logging

from telegram.ext import Application

import config
from handlers import antispam, bienvenida, comandos


def main() -> None:
    if not config.TOKEN:
        raise SystemExit("Falta TELEGRAM_BOT_TOKEN en el archivo .env")

    # Evita que las librerías HTTP registren URLs (que contienen el token)
    logging.basicConfig(level=logging.WARNING)
    for nombre in ("httpx", "httpcore", "telegram", "apscheduler"):
        logging.getLogger(nombre).setLevel(logging.WARNING)

    app = Application.builder().token(config.TOKEN).build()
    app.add_handler(bienvenida.handler())
    for h in comandos.handlers():
        app.add_handler(h)
    app.add_handler(antispam.handler())
    print("Bot DMCRIPTO iniciado.")
    app.run_polling(allowed_updates=["message"])


if __name__ == "__main__":
    main()
