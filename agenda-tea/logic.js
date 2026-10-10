// Lógica pura de la agenda (sin DOM) para poder probarla con Node.
export const pad = (n) => String(n).padStart(2, '0');
export const monthKey = (y, m) => `${y}-${pad(m + 1)}`; // m: 0-11
export const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
export const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m: m - 1, d }; };
export const addMonth = (y, m, k = 1) => { const t = y * 12 + m + k; return { y: Math.floor(t / 12), m: t % 12 }; };

// Mismo "n-ésimo día de la semana" en otro mes (ej.: 2.º martes). Si no existe el 5.º, usa el último.
export function mapDate(dateStr, ty, tm) {
  const { y, m, d } = parseISO(dateStr);
  const wd = new Date(y, m, d).getDay();
  const nth = Math.ceil(d / 7);
  const isLast = d + 7 > daysIn(y, m);
  const first = new Date(ty, tm, 1).getDay();
  const firstDay = 1 + ((wd - first + 7) % 7);
  const total = daysIn(ty, tm);
  let day = firstDay + (nth - 1) * 7;
  if (isLast) { day = firstDay; while (day + 7 <= total) day += 7; }
  else if (day > total) day -= 7;
  return iso(ty, tm, day);
}

// Genera los meses siguientes a la plantilla (hasta `horizon` meses desde `now`) que aún no existan.
export function autoFill(state, now = new Date(), horizon = 1) {
  const t = state.template;
  if (!t) return [];
  const created = [];
  const [ty, tm] = [Number(t.split('-')[0]), Number(t.split('-')[1]) - 1];
  const src = state.events.filter((e) => e.date.startsWith(t) && !e.auto);
  const last = addMonth(now.getFullYear(), now.getMonth(), horizon);
  for (let k = 1; ; k++) {
    const { y, m } = addMonth(ty, tm, k);
    if (y * 12 + m > last.y * 12 + last.m) break;
    const key = monthKey(y, m);
    if (state.generated.includes(key)) continue;
    for (const e of src) {
      created.push({ ...e, id: `${e.id}@${key}`, date: mapDate(e.date, y, m), auto: true, fromId: e.id });
    }
    state.generated.push(key);
  }
  state.events.push(...created);
  return created;
}

// Alarmas que deben sonar ahora: [{event, lead}]. `fired` es un objeto id|lead -> true.
export function dueAlarms(events, now, fired, windowMin = 30) {
  const out = [];
  for (const e of events) {
    const { y, m, d } = parseISO(e.date);
    const [hh, mm] = (e.time || '00:00').split(':').map(Number);
    const start = new Date(y, m, d, hh, mm).getTime();
    for (const lead of e.remind || []) {
      const at = start - lead * 60000;
      const k = `${e.id}|${lead}`;
      if (!fired[k] && now >= at && now <= at + windowMin * 60000 && now <= start + 60000) out.push({ event: e, lead, key: k });
    }
  }
  return out;
}

// Exporta .ics con VALARM: suenan aunque la app esté cerrada (calendario del teléfono).
export function toICS(events) {
  const esc = (s = '') => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const stamp = (d, t) => d.replace(/-/g, '') + 'T' + (t || '00:00').replace(':', '') + '00';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Agenda TEA//ES', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@agenda-tea`, `DTSTAMP:${stamp(e.date, e.time)}`,
      `DTSTART:${stamp(e.date, e.time)}`, `SUMMARY:${esc(e.title)}`);
    if (e.place) lines.push(`LOCATION:${esc(e.place)}`);
    if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
    for (const lead of e.remind || []) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${lead}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
