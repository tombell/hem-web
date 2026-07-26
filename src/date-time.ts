const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function parseRfc3339(value: string): number | undefined {
  const match = value.match(RFC3339_PATTERN);
  if (!match) return undefined;

  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match;
  if (
    !isValidCalendarDate(Number(year), Number(month), Number(day)) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (offsetHour !== undefined && Number(offsetHour) > 23) ||
    (offsetMinute !== undefined && Number(offsetMinute) > 59)
  ) {
    return undefined;
  }

  const epochMilliseconds = Date.parse(value);
  return Number.isFinite(epochMilliseconds) ? epochMilliseconds : undefined;
}

export function parseIsoDate(value: string): boolean {
  const match = value.match(ISO_DATE_PATTERN);
  return (
    match !== null && isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
  );
}

export function requireEpochMilliseconds(value: string): number {
  const epochMilliseconds = parseRfc3339(value);
  if (epochMilliseconds === undefined) {
    throw new Error(`Invalid RFC 3339 timestamp: ${value}`);
  }
  return epochMilliseconds;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
