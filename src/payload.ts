export interface QuantityValue {
  value: number;
  unit: string;
}

export interface SourceInfo {
  app?: string;
  bundleIdentifier?: string;
  deviceIdentifier?: string;
  deviceName?: string;
  deviceSystemName?: string;
  deviceSystemVersion?: string;
}

export interface RangeInfo {
  calendar: string;
  end: string;
  kind: string;
  start: string;
  timeZone: string;
}

export interface DailyMetricRecord {
  date: string;
  [metric: string]: QuantityValue | string;
}

export interface SampleRecord {
  end: string;
  start: string;
  type: string;
  unit: string;
  value: number;
}

export interface WorkoutRecord {
  activeEnergy?: QuantityValue;
  activityType: string;
  distance?: QuantityValue;
  duration?: QuantityValue;
  end: string;
  id?: string;
  start: string;
}

export interface SleepRecord {
  end: string;
  start: string;
  value: string;
}

export interface HealthPayload {
  dailyMetrics: DailyMetricRecord[];
  generatedAt: string;
  range: RangeInfo;
  samples: SampleRecord[];
  schemaVersion: 1;
  sleep: SleepRecord[];
  source: SourceInfo;
  workouts: WorkoutRecord[];
}

export interface ValidationSuccess {
  ok: true;
  payload: HealthPayload;
}

export interface ValidationFailure {
  error: string;
  ok: false;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export function validateHealthPayload(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return invalid("payload must be an object");
  }

  if (input.schemaVersion !== 1) {
    return invalid("schemaVersion must be 1");
  }

  const sourceResult = validateSource(input.source);
  if (!sourceResult.ok) return sourceResult;

  const generatedAtResult = requireIsoDateTime(input.generatedAt, "generatedAt");
  if (!generatedAtResult.ok) return generatedAtResult;

  const rangeResult = validateRange(input.range);
  if (!rangeResult.ok) return rangeResult;

  const dailyMetricsResult = validateOptionalArray(
    input.dailyMetrics,
    "dailyMetrics",
    validateDailyMetricRecord,
  );
  if (!dailyMetricsResult.ok) return dailyMetricsResult;

  const samplesResult = validateOptionalArray(input.samples, "samples", validateSampleRecord);
  if (!samplesResult.ok) return samplesResult;

  const workoutsResult = validateOptionalArray(input.workouts, "workouts", validateWorkoutRecord);
  if (!workoutsResult.ok) return workoutsResult;

  const sleepResult = validateOptionalArray(input.sleep, "sleep", validateSleepRecord);
  if (!sleepResult.ok) return sleepResult;

  return {
    ok: true,
    payload: {
      dailyMetrics: dailyMetricsResult.value,
      generatedAt: input.generatedAt,
      range: rangeResult.value,
      samples: samplesResult.value,
      schemaVersion: 1,
      sleep: sleepResult.value,
      source: sourceResult.value,
      workouts: workoutsResult.value,
    },
  };
}

export function getSourceKey(payload: HealthPayload): string {
  const deviceIdentifier = payload.source.deviceIdentifier?.trim();
  if (deviceIdentifier) return deviceIdentifier;

  return payload.source.deviceName!.trim();
}

export function isQuantityValue(value: unknown): value is QuantityValue {
  return (
    isRecord(value) &&
    typeof value.value === "number" &&
    Number.isFinite(value.value) &&
    nonEmptyString(value.unit)
  );
}

function validateSource(input: unknown): ValidationResultFor<SourceInfo> {
  if (!isRecord(input)) {
    return invalid("source must be an object");
  }

  const result = validateOptionalStrings(input, "source", [
    "app",
    "bundleIdentifier",
    "deviceIdentifier",
    "deviceName",
    "deviceSystemName",
    "deviceSystemVersion",
  ]);
  if (!result.ok) return result;

  const deviceIdentifier = input.deviceIdentifier?.trim();
  const deviceName = input.deviceName?.trim();
  if (!deviceIdentifier && !deviceName) {
    return invalid("source.deviceIdentifier or source.deviceName is required");
  }

  return {
    ok: true,
    value: {
      app: input.app,
      bundleIdentifier: input.bundleIdentifier,
      deviceIdentifier: input.deviceIdentifier,
      deviceName: input.deviceName,
      deviceSystemName: input.deviceSystemName,
      deviceSystemVersion: input.deviceSystemVersion,
    },
  };
}

function validateRange(input: unknown): ValidationResultFor<RangeInfo> {
  if (!isRecord(input)) {
    return invalid("range must be an object");
  }

  for (const key of ["calendar", "kind", "timeZone"] as const) {
    if (!nonEmptyString(input[key])) {
      return invalid(`range.${key} is required`);
    }
  }

  const startResult = requireIsoDateTime(input.start, "range.start");
  if (!startResult.ok) return startResult;

  const endResult = requireIsoDateTime(input.end, "range.end");
  if (!endResult.ok) return endResult;

  return {
    ok: true,
    value: {
      calendar: input.calendar,
      end: input.end,
      kind: input.kind,
      start: input.start,
      timeZone: input.timeZone,
    },
  };
}

function validateDailyMetricRecord(
  input: unknown,
  index: number,
): ValidationResultFor<DailyMetricRecord> {
  if (!isRecord(input)) {
    return invalid(`dailyMetrics[${index}] must be an object`);
  }

  if (!nonEmptyString(input.date)) {
    return invalid(`dailyMetrics[${index}].date is required`);
  }

  const record: DailyMetricRecord = { date: input.date };
  for (const [metric, value] of Object.entries(input)) {
    if (metric === "date") continue;
    if (!isQuantityValue(value)) {
      return invalid(`dailyMetrics[${index}].${metric} must have numeric value and unit`);
    }
    record[metric] = value;
  }

  return { ok: true, value: record };
}

function validateSampleRecord(input: unknown, index: number): ValidationResultFor<SampleRecord> {
  if (!isRecord(input)) {
    return invalid(`samples[${index}] must be an object`);
  }

  for (const key of ["type", "start", "end", "unit"] as const) {
    if (!nonEmptyString(input[key])) {
      return invalid(`samples[${index}].${key} is required`);
    }
  }

  if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
    return invalid(`samples[${index}].value must be a finite number`);
  }

  return {
    ok: true,
    value: {
      end: input.end,
      start: input.start,
      type: input.type,
      unit: input.unit,
      value: input.value,
    },
  };
}

function validateWorkoutRecord(input: unknown, index: number): ValidationResultFor<WorkoutRecord> {
  if (!isRecord(input)) {
    return invalid(`workouts[${index}] must be an object`);
  }

  for (const key of ["activityType", "start", "end"] as const) {
    if (!nonEmptyString(input[key])) {
      return invalid(`workouts[${index}].${key} is required`);
    }
  }

  if (input.id !== undefined && !nonEmptyString(input.id)) {
    return invalid(`workouts[${index}].id must be a non-empty string when provided`);
  }

  for (const key of ["duration", "activeEnergy", "distance"] as const) {
    if (input[key] !== undefined && !isQuantityValue(input[key])) {
      return invalid(`workouts[${index}].${key} must have numeric value and unit`);
    }
  }

  return {
    ok: true,
    value: {
      activeEnergy: input.activeEnergy,
      activityType: input.activityType,
      distance: input.distance,
      duration: input.duration,
      end: input.end,
      id: input.id,
      start: input.start,
    },
  };
}

function validateSleepRecord(input: unknown, index: number): ValidationResultFor<SleepRecord> {
  if (!isRecord(input)) {
    return invalid(`sleep[${index}] must be an object`);
  }

  for (const key of ["start", "end", "value"] as const) {
    if (!nonEmptyString(input[key])) {
      return invalid(`sleep[${index}].${key} is required`);
    }
  }

  return {
    ok: true,
    value: {
      end: input.end,
      start: input.start,
      value: input.value,
    },
  };
}

function validateOptionalArray<T>(
  input: unknown,
  name: string,
  validateItem: (item: unknown, index: number) => ValidationResultFor<T>,
): ValidationResultFor<T[]> {
  if (input === undefined) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(input)) {
    return invalid(`${name} must be an array when provided`);
  }

  const value: T[] = [];
  for (const [index, item] of input.entries()) {
    const result = validateItem(item, index);
    if (!result.ok) return result;
    value.push(result.value);
  }

  return { ok: true, value };
}

function validateOptionalStrings(
  input: Record<string, unknown>,
  prefix: string,
  keys: string[],
): ValidationResultFor<void> {
  for (const key of keys) {
    const value = input[key];
    if (value !== undefined && typeof value !== "string") {
      return invalid(`${prefix}.${key} must be a string when provided`);
    }
  }

  return { ok: true, value: undefined };
}

function requireIsoDateTime(input: unknown, path: string): ValidationResultFor<string> {
  if (!nonEmptyString(input)) {
    return invalid(`${path} is required`);
  }

  if (Number.isNaN(Date.parse(input))) {
    return invalid(`${path} must be a valid date/time string`);
  }

  return { ok: true, value: input };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

type ValidationResultFor<T> = { ok: true; value: T } | { error: string; ok: false };

function invalid(error: string): ValidationFailure {
  return { error, ok: false };
}
