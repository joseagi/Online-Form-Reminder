// Times in emails. An activity keeps its own clock time and time zone (as entered); when its zone
// is not the office's, the office-time equivalent is shown as well, computed from the stored
// instant, so clock changes in either zone are taken into account.

const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });

function parts(iso: string, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
}

// The calendar date (YYYY-MM-DD) of an instant in a time zone.
export function localDate(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

// The clock time (HH:MM, 24-hour) of an instant in a time zone.
export function localTime(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return `${p.hour}:${p.minute}`;
}

// "(Europe/London time; starts 10:00 Africa/Lagos time)", with the office weekday when the
// activity starts on another day there. Empty for activities in office time.
export function zoneNote(input: { timezone: string; activityDate: string; startsAt: string; officeTimezone: string }): string {
  if (input.timezone === input.officeTimezone) return '';
  const officeDay = localDate(input.startsAt, input.officeTimezone);
  const day = officeDay === input.activityDate ? '' : `${weekday.format(new Date(`${officeDay}T00:00:00Z`))} `;
  return ` (${input.timezone} time; starts ${day}${localTime(input.startsAt, input.officeTimezone)} ${input.officeTimezone} time)`;
}
