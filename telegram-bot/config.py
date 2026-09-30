"""Configuración central. El token se lee solo del .env y nunca se imprime."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent
load_dotenv(BASE_DIR / ".env")

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()

# Antispam
HORAS_USUARIO_NUEVO = 24     # antes de esto, sus enlaces se borran
REPETIDOS_MAX = 3            # mismo texto N veces...
REPETIDOS_VENTANA_SEG = 60   # ...dentro de esta ventana

ARCHIVO_CONFIANZA = BASE_DIR / "trusted_users.json"
ARCHIVO_LOG = BASE_DIR / "moderacion.log"
