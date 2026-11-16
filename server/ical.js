// iCalendar feed: job due dates, tasks and invoice due dates as all-day events.
// Subscribe once in Google Calendar ("From URL") or iPhone Calendar and it stays updated — free.
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const day = (d) => d.replace(/-/g, '');
const next = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10).replace(/-/g, ''); };
// fold long lines at 74 octets as RFC 5545 requires
const fold = (line) => { const out = []; let s = line; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = ' ' + s.slice(n); } out.push(s); return out.join('\r\n'); };

export function buildIcs({ settings, jobs, tasks, invoices, customers, staff }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const cust = (id) => customers.find((c) => c.id === id);
  const ev = [];
  const add = (uid, date, summary, desc, location) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return;
    ev.push(['BEGIN:VEVENT', `UID:${uid}@woodworks`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(date)}`, `DTEND;VALUE=DATE:${next(date)}`,
      `SUMMARY:${esc(summary)}`, desc ? `DESCRIPTION:${esc(desc)}` : '', location ? `LOCATION:${esc(location)}` : '', 'END:VEVENT'].filter(Boolean));
  };
  for (const j of jobs) if (!['completed', 'cancelled'].includes(j.status)) {
    const c = cust(j.customerId);
    const site = j.details?.['Site address'] || c?.address;
    add(`job-${j.id}`, j.dueDate, `🪵 Due: ${j.code} ${j.title}`, `Customer: ${c?.name || '-'}\nStatus: ${j.status}\nProgress: ${j.progress || 0}%`, site);
  }
  for (const t of tasks) if (t.status !== 'done') {
    const s = staff.find((x) => x.id === t.staffId);
    add(`task-${t.id}`, t.dueDate, `🔨 ${t.title}${s ? ' — ' + s.name : ''}`, t.notes || '');
  }
  for (const i of invoices) if (i.dueDate) add(`inv-${i.id}`, i.dueDate, `💰 Invoice due: ${i.number} (${cust(i.customerId)?.name || '-'})`, i.title || '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WoodWorks Pro//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc((settings.businessName || 'Workshop') + ' — Jobs')}`, 'X-PUBLISHED-TTL:PT1H', ...ev.flat(), 'END:VCALENDAR']
    .map(fold).join('\r\n') + '\r\n';
}
