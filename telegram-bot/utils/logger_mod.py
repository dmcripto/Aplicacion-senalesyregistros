"""Registro de acciones de moderación. Nunca se registra el token."""
import logging

import config

_log = logging.getLogger("moderacion")
_log.setLevel(logging.INFO)
_log.propagate = False
if not _log.handlers:
    _h = logging.FileHandler(config.ARCHIVO_LOG, encoding="utf-8")
    _h.setFormatter(logging.Formatter("%(asctime)s | %(message)s"))
    _log.addHandler(_h)


def registrar(accion: str, chat_id: int, user_id: int, motivo: str) -> None:
    _log.info("accion=%s chat=%s usuario=%s motivo=%s", accion, chat_id, user_id, motivo)
