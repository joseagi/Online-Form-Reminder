// Whole minutes since `iso`. For Server Components rendered at request time (after the session
// check, which opts out of prerendering), where reading the clock is expected.
export function minutesSince(iso: string): number {
  return Math.floor((Date.now() - Date.parse(iso)) / 60_000);
}
