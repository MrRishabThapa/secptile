/**
 * Time formatting helpers for the Clock surface (`/clock`).
 * Pure functions — no server, no browser APIs — so they are safe to unit-test
 * and to import from any client component.
 */

/** Zero-pad a number to two digits ("7" → "07"). */
export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local wall-clock time as HH:MM:SS (24h). */
export function formatWallClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
    date.getSeconds(),
  )}`;
}

/** Duration as h:mm:ss or mm:ss (hours only when nonzero). */
export function formatDuration(totalMs: number): string {
  const ms = Math.max(0, Math.floor(totalMs));
  const secondsTotal = Math.ceil(ms / 1000);
  const hours = Math.floor(secondsTotal / 3600);
  const minutes = Math.floor((secondsTotal % 3600) / 60);
  const seconds = secondsTotal % 60;
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
    : `${pad2(minutes)}:${pad2(seconds)}`;
}

/** Stopwatch reading as mm:ss.cs (centiseconds; h:mm:ss.cs past an hour). */
export function formatStopwatch(totalMs: number): string {
  const ms = Math.max(0, totalMs);
  const secondsTotal = Math.floor(ms / 1000);
  const centiseconds = Math.floor((ms % 1000) / 10);
  const hours = Math.floor(secondsTotal / 3600);
  const minutes = Math.floor((secondsTotal % 3600) / 60);
  const seconds = secondsTotal % 60;
  const core = `${pad2(minutes)}:${pad2(seconds)}.${pad2(centiseconds)}`;
  return hours > 0 ? `${hours}:${core}` : core;
}

/** "UTC+05:45"-style offset string for the browser's current zone. */
export function formatUtcOffset(date: Date): string {
  // getTimezoneOffset() is minutes BEHIND UTC (UTC+05:45 → -345).
  const totalMinutes = -date.getTimezoneOffset();
  const sign = totalMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(totalMinutes);
  return `UTC${sign}${pad2(Math.floor(absMinutes / 60))}:${pad2(absMinutes % 60)}`;
}
