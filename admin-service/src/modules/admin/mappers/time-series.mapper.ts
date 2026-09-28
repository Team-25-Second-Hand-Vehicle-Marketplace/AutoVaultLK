export type DayCountRow = {
  day: Date | string;
  count: string | number;
};

export type TimeSeriesRaw = {
  listingRows: DayCountRow[];
  userRows: DayCountRow[];
  uploadRows: DayCountRow[];
};

export type TimeSeriesPoint = { date: string; count: number };

export type TimeSeriesDto = {
  from: string;
  to: string;
  listings: TimeSeriesPoint[];
  users: TimeSeriesPoint[];
  uploads: TimeSeriesPoint[];
};

/**
 * A GROUP BY only returns rows for days that had activity — a day with zero
 * signups would otherwise be missing from the series entirely rather than
 * showing zero, which would silently compress the x-axis (30 calendar days
 * rendered as however many actually had rows) and misrepresent quiet days
 * as if they never happened.
 */
export function mapTimeSeries(raw: TimeSeriesRaw, from: Date, to: Date): TimeSeriesDto {
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    listings: toDailyPoints(raw.listingRows, from, to),
    users: toDailyPoints(raw.userRows, from, to),
    uploads: toDailyPoints(raw.uploadRows, from, to),
  };
}

function toDailyPoints(rows: DayCountRow[], from: Date, to: Date): TimeSeriesPoint[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(toDateKey(row.day), Number(row.count));
  }

  const points: TimeSeriesPoint[] = [];
  const cursor = startOfUtcDay(from);
  const end = startOfUtcDay(to);

  while (cursor.getTime() <= end.getTime()) {
    const key = toDateKey(cursor);
    points.push({ date: key, count: counts.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return points;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toDateKey(day: Date | string): string {
  const d = typeof day === 'string' ? new Date(day) : day;
  return d.toISOString().slice(0, 10);
}
