import { describe, it, expect } from 'vitest';
// @ts-ignore JS puro
import { mapDate, autoFill, dueAlarms, toICS } from '../agenda-tea/logic.js';

describe('agenda-tea', () => {
  it('repite el n-ésimo día de la semana', () => {
    expect(mapDate('2026-03-10', 2026, 3)).toBe('2026-04-14'); // 2.º martes
  });
  it('si no existe el 5.º usa el último', () => {
    expect(mapDate('2026-03-31', 2026, 3)).toBe('2026-04-28'); // último martes
  });
  it('completa los meses siguientes una sola vez', () => {
    const s: any = { template: '2026-03', generated: [], events: [{ id: 'a', title: 'T', type: 'terapia', date: '2026-03-10', time: '10:00', remind: [10] }] };
    const n = autoFill(s, new Date(2026, 4, 5)).length; // mayo -> hasta junio
    expect(n).toBe(3);
    expect(autoFill(s, new Date(2026, 4, 5)).length).toBe(0);
    expect(s.events.filter((e: any) => e.auto).map((e: any) => e.date)).toEqual(['2026-04-14', '2026-05-12', '2026-06-09']);
  });
  it('dispara la alarma en su ventana y no se repite', () => {
    const ev = [{ id: 'a', date: '2026-03-10', time: '10:00', remind: [10] }];
    const at = new Date(2026, 2, 10, 9, 49).getTime();
    expect(dueAlarms(ev, at, {})).toHaveLength(0);
    const on = new Date(2026, 2, 10, 9, 51, 30).getTime();
    expect(dueAlarms(ev, on, {})).toHaveLength(1);
    expect(dueAlarms(ev, on, { 'a|10': true })).toHaveLength(0);
  });
  it('exporta VALARM', () => {
    expect(toICS([{ id: 'a', title: 'X', date: '2026-03-10', time: '10:00', remind: [30] }])).toContain('TRIGGER:-PT30M');
  });
});
