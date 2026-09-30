"""Usuarios de confianza: los admins del grupo y los IDs de trusted_users.json."""
import json

import config


def _ids_archivo() -> set[int]:
    try:
        datos = json.loads(config.ARCHIVO_CONFIANZA.read_text(encoding="utf-8"))
        return {int(i) for i in datos.get("usuarios_confianza", [])}
    except (OSError, ValueError):
        return set()


async def es_de_confianza(chat, user_id: int) -> bool:
    if user_id in _ids_archivo():
        return True
    try:
        miembro = await chat.get_member(user_id)
    except Exception:
        return False
    return miembro.status in ("administrator", "creator")
