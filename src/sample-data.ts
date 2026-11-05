import type {
  CategorySampleRecord,
  DailyMetricRecord,
  HealthPayload,
  SampleRecord,
  SleepRecord,
  SourceInfo,
  WorkoutRecord,
} from "./payload.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MINUTE = 60_000;

export interface SampleOptions {
  /** Number of days of history ending now. */
  days?: number;
  now?: Date;
  /** PRNG seed; the same seed and `now` produce the same payloads. */
  seed?: number;
}

const phone: SourceInfo = {
  app: "Hem",
  bundleIdentifier: "com.example.hem",
  deviceName: "Sample iPhone",
  deviceSystemName: "iOS",
  deviceSystemVersion: "26.1",
};
const watch: SourceInfo = {
  app: "Hem",
  bundleIdentifier: "com.example.hem",
  deviceName: "Sample Apple Watch",
  deviceSystemName: "watchOS",
  deviceSystemVersion: "26.1",
};

/**
 * Builds realistic, fictional Apple Health exports split into weekly imports per
 * source. Includes missing days, overlapping sleep intervals, and mixed workouts so
 * every dashboard view has something to show.
 */
export function samplePayloads({
  days = 120,
  now = new Date(),
  seed = 1,
}: SampleOptions = {}): HealthPayload[] {
  let state = seed % 2_147_483_647 || 1;
  const random = () => (state = (state * 16_807) % 2_147_483_647) / 2_147_483_647;
  const between = (min: number, max: number) => min + random() * (max - min);

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const firstDay = new Date(today);
  firstDay.setDate(firstDay.getDate() - days + 1);

  const phoneData = emptyData();
  const watchData = emptyData();

  for (let offset = 0; offset < days; offset++) {
    const date = new Date(firstDay);
    date.setDate(date.getDate() + offset);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    // Slow seasonal drift keeps the charts from looking like pure noise.
    const trend = Math.sin((offset / days) * Math.PI * 2);
    const at = (hours: number) => +date + hours * HOUR;

    // Each device misses roughly one day in fifteen (left at home, or charging), to
    // exercise gap handling. The watch counts slightly differently from the phone.
    const steps = between(5_500, 11_500) + trend * 1_500 + (weekend ? 1_800 : 0);
    const exercise = between(8, 55) + (weekend ? 15 : 0);
    if (random() > 0.07) {
      phoneData.dailyMetrics.push({
        date: localDate(date),
        activeEnergy: { unit: "kcal", value: round(steps * between(0.045, 0.06)) },
        exerciseTime: { unit: "min", value: round(exercise) },
        flightsClimbed: { unit: "count", value: round(between(2, 18)) },
        steps: { unit: "count", value: round(steps) },
        walkingRunningDistance: { unit: "km", value: round(steps * 0.00075, 1) },
      });
    }
    if (random() > 0.07) {
      const watchSteps = steps * between(0.95, 1.12);
      watchData.dailyMetrics.push({
        date: localDate(date),
        activeEnergy: { unit: "kcal", value: round(watchSteps * between(0.05, 0.065)) },
        exerciseTime: { unit: "min", value: round(exercise * between(1, 1.25)) },
        standTime: { unit: "min", value: round(between(90, 260)) },
        steps: { unit: "count", value: round(watchSteps) },
        walkingRunningDistance: { unit: "km", value: round(watchSteps * 0.00074, 1) },
      });
    }

    if (at(8) < +now) {
      watchData.samples.push(
        sample("restingHeartRate", "count/min", round(between(52, 60) - trend * 2), at(7)),
        sample("heartRateVariabilitySDNN", "ms", round(between(38, 62) + trend * 5), at(7)),
      );
    }

    if (random() < 0.35 && at(20) < +now) {
      const start = at(between(7, 19));
      watchData.categorySamples.push({
        type: "mindfulSession",
        value: "notApplicable",
        start: iso(start),
        end: iso(start + round(between(5, 15)) * MINUTE),
      });
    }

    const workoutChance = weekend ? 0.75 : 0.4;
    if (random() < workoutChance) {
      const activity = pick(random, [
        ["running", 5.6],
        ["running", 5.6],
        ["cycling", 2.4],
        ["walking", 11],
        ["traditionalStrengthTraining", 0],
        ["yoga", 0],
      ] as const);
      const minutes = round(between(22, weekend ? 75 : 50));
      const start = at(weekend ? between(8, 11) : between(6.5, 7.5));
      if (start + minutes * MINUTE < +now) {
        const workout: WorkoutRecord = {
          id: `sample-workout-${localDate(date)}`,
          activityType: activity[0],
          start: iso(start),
          end: iso(start + minutes * MINUTE),
          duration: { unit: "min", value: minutes },
          activeEnergy: { unit: "kcal", value: round(minutes * between(6, 11)) },
        };
        if (activity[1]) workout.distance = { unit: "km", value: round(minutes / activity[1], 2) };
        (random() < 0.8 ? watchData : phoneData).workouts.push(workout);
      }
    }

    // Night starting this evening.
    const bedtime = at(between(22.2, 23.6) + (weekend ? 0.6 : 0));
    const wake = bedtime + between(6.6, 8.4) * HOUR;
    if (wake < +now && random() > 0.05) {
      watchData.sleep.push({ value: "inBed", start: iso(bedtime), end: iso(wake) });
      let cursor = bedtime + between(8, 25) * MINUTE;
      let cycle = 0;
      while (cursor < wake - 20 * MINUTE) {
        const stages: Array<[string, number]> = [
          ["asleepCore", between(15, 35)],
          ["asleepDeep", between(cycle < 2 ? 30 : 5, cycle < 2 ? 55 : 20)],
          ["asleepCore", between(15, 30)],
          ["asleepREM", between(cycle < 2 ? 10 : 25, cycle < 2 ? 20 : 45)],
        ];
        if (random() < 0.4) stages.push(["awake", between(2, 9)]);
        for (const [value, minutes] of stages) {
          const end = Math.min(cursor + minutes * MINUTE, wake);
          if (end - cursor < MINUTE) break;
          watchData.sleep.push({ value, start: iso(cursor), end: iso(end) });
          cursor = end;
        }
        cycle++;
      }
    }
  }

  return [...weekly(phone, phoneData, firstDay, now), ...weekly(watch, watchData, firstDay, now)];
}

interface SourceData {
  categorySamples: CategorySampleRecord[];
  dailyMetrics: DailyMetricRecord[];
  samples: SampleRecord[];
  sleep: SleepRecord[];
  workouts: WorkoutRecord[];
}

function emptyData(): SourceData {
  return { categorySamples: [], dailyMetrics: [], samples: [], sleep: [], workouts: [] };
}

/** Splits one source's records into weekly imports, like the iOS app sends them. */
function weekly(source: SourceInfo, data: SourceData, firstDay: Date, now: Date): HealthPayload[] {
  // Boundaries at midday keep each night's sleep inside a single import.
  const payloads: HealthPayload[] = [];
  let start = +firstDay - 12 * HOUR;
  while (start < +now) {
    const end = Math.min(start + 7 * DAY, +now);
    const inside = <T extends { start: string; end: string }>(records: T[]) =>
      records.filter((row) => Date.parse(row.start) >= start && Date.parse(row.end) <= end);
    const dailyMetrics = data.dailyMetrics.filter((row) => {
      const midday = Date.parse(`${row.date}T12:00:00`);
      return midday >= start && midday < end;
    });
    const payload: HealthPayload = {
      schemaVersion: 1,
      generatedAt: iso(Math.min(end + HOUR, +now)),
      range: {
        calendar: "gregorian",
        kind: "custom",
        start: iso(start),
        end: iso(end),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      source,
      dailyMetrics,
      samples: inside(data.samples),
      categorySamples: inside(data.categorySamples),
      workouts: inside(data.workouts),
      sleep: inside(data.sleep),
    };
    if (
      payload.dailyMetrics.length +
      payload.samples.length +
      payload.categorySamples.length +
      payload.workouts.length +
      payload.sleep.length
    )
      payloads.push(payload);
    start = end;
  }
  return payloads;
}

function sample(type: string, unit: string, value: number, time: number): SampleRecord {
  return { type, unit, value, start: iso(time), end: iso(time) };
}

function round(value: number, digits = 0): number {
  return +value.toFixed(digits);
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)];
}

function iso(time: number): string {
  return new Date(time).toISOString();
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
