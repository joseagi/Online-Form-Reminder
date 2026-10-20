// Display helpers for an activity's stored wall-clock values (date "2026-11-03", time "10:00:00").
// These are the times as entered, in the activity's own time zone, so no conversion is needed.

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

// "10:00:00" -> "10:00"
export function formatTime(time: string | null): string {
  return time ? time.slice(0, 5) : '';
}

// A moment (e.g. when a change was made) in the given time zone: "21 Oct 2026, 14:05".
export function formatTimestamp(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

export function formatWhen(activity: { activity_date: string; start_time: string | null; end_time: string | null }): string {
  const date = formatDate(activity.activity_date);
  if (!activity.start_time) return `${date} (all day)`;
  const end = activity.end_time ? `–${formatTime(activity.end_time)}` : '';
  return `${date}, ${formatTime(activity.start_time)}${end}`;
}
