export function getUtcDayKey(now: number, offsetDays = 0): string {
  const date = new Date(now);
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + offsetDays
    )
  )
    .toISOString()
    .slice(0, 10);
}
