# Mi Agenda (prototipo)

Calendario de terapias y turnos con alarmas, pensado para personas autistas: interfaz tranquila, sin movimiento brusco, texto ajustable.

- **Mes automático:** se carga un mes una vez, se toca «Usar este mes como modelo» y los meses siguientes se completan solos (mismo día de la semana, ej. «2.º martes»).
- **Alarmas:** pantalla grande + sonido suave + notificación mientras la pestaña está abierta; se puede posponer 5 min.
- **Alarmas con la app cerrada:** «Exportar al teléfono (.ics)» crea un archivo con alarmas (VALARM) para el calendario del móvil.
- Los datos quedan solo en el navegador (localStorage).

Probar: `cd agenda-tea && python3 -m http.server 8080` y abrir http://localhost:8080. Pruebas: `npx vitest run tests/agenda-tea.test.ts`.
