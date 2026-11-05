export const dateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export const time = (value: string | number) =>
  new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const calendarFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const shortFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** Formats a calendar date (YYYY-MM-DD) without shifting it into another timezone. */
export const calendarDate = (value: string, weekday = true) =>
  (weekday ? calendarFormat : shortFormat).format(new Date(`${value}T00:00:00Z`));
