export type TradingSession = "Asia" | "London" | "New York" | "Overlap" | "Unknown";

export interface SessionWindow {
  name: Exclude<TradingSession, "Overlap" | "Unknown">;
  startHourUtc: number;
  endHourUtc: number;
}

const DEFAULT_WINDOWS: SessionWindow[] = [
  { name: "Asia", startHourUtc: 0, endHourUtc: 8 },
  { name: "London", startHourUtc: 8, endHourUtc: 13 },
  { name: "New York", startHourUtc: 13, endHourUtc: 21 },
];

export function detectTradingSession(
  timestamp: string,
  windows: SessionWindow[] = DEFAULT_WINDOWS,
): TradingSession {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid timestamp.");

  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  const matches = windows.filter(window => {
    if (window.startHourUtc < window.endHourUtc) {
      return hour >= window.startHourUtc && hour < window.endHourUtc;
    }
    return hour >= window.startHourUtc || hour < window.endHourUtc;
  });

  if (matches.length === 0) return "Unknown";
  if (matches.length > 1) return "Overlap";
  return matches[0].name;
}
