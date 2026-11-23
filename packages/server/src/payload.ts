import { parseIsoDate, parseRfc3339 } from "./date-time.ts";

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
  id?: string;
  start: string;
  type: string;
  unit: string;
  value: number;
}

export interface CategorySampleRecord {
  end: string;
  id?: string;
  start: string;
  type: string;
  value: string;
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
  id?: string;
  start: string;
  value: string;
}

export interface HealthPayload {
  categorySamples: Array<CategorySampleRecord>;
  dailyMetrics: Array<DailyMetricRecord>;
  generatedAt: string;
  range: RangeInfo;
  samples: Array<SampleRecord>;
  schemaVersion: 1;
  sleep: Array<SleepRecord>;
  source: SourceInfo;
  workouts: Array<WorkoutRecord>;
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
  if (!sourceResult.ok) {
    return sourceResult;
  }

  const generatedAtResult = requireIsoDateTime(input.generatedAt, "generatedAt");
  if (!generatedAtResult.ok) {
    return generatedAtResult;
  }

  const rangeResult = validateRange(input.range);
  if (!rangeResult.ok) {
    return rangeResult;
  }

  const dailyMetricsResult = validateOptionalArray(
    input.dailyMetrics,
    "dailyMetrics",
    validateDailyMetricRecord,
  );
  if (!dailyMetricsResult.ok) {
    return dailyMetricsResult;
  }

  const samplesResult = validateOptionalArray(input.samples, "samples", validateSampleRecord);
  if (!samplesResult.ok) {
    return samplesResult;
  }

  const categorySamplesResult = validateOptionalArray(
    input.categorySamples,
    "categorySamples",
    validateCategorySampleRecord,
  );
  if (!categorySamplesResult.ok) {
    return categorySamplesResult;
  }

  const workoutsResult = validateOptionalArray(input.workouts, "workouts", validateWorkoutRecord);
  if (!workoutsResult.ok) {
    return workoutsResult;
  }

  const sleepResult = validateOptionalArray(input.sleep, "sleep", validateSleepRecord);
  if (!sleepResult.ok) {
    return sleepResult;
  }

  for (const [name, records] of [
    ["categorySamples", categorySamplesResult.value],
    ["samples", samplesResult.value],
    ["workouts", workoutsResult.value],
    ["sleep", sleepResult.value],
  ] as const) {
    const containedResult = validateContainedIntervals(records, name, rangeResult.value);
    if (!containedResult.ok) {
      return containedResult;
    }
  }

  return {
    ok: true,
    payload: {
      categorySamples: categorySamplesResult.value,
      dailyMetrics: dailyMetricsResult.value,
      generatedAt: generatedAtResult.value,
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
  if (deviceIdentifier) {
    return deviceIdentifier;
  }

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
  if (!result.ok) {
    return result;
  }

  const source = result.value;
  if (!source.deviceIdentifier?.trim() && !source.deviceName?.trim()) {
    return invalid("source.deviceIdentifier or source.deviceName is required");
  }

  return { ok: true, value: source };
}

function validateRange(input: unknown): ValidationResultFor<RangeInfo> {
  if (!isRecord(input)) {
    return invalid("range must be an object");
  }

  const calendar = requireString(input.calendar, "range.calendar");
  if (!calendar.ok) {
    return calendar;
  }
  const kind = requireString(input.kind, "range.kind");
  if (!kind.ok) {
    return kind;
  }
  const timeZone = requireString(input.timeZone, "range.timeZone");
  if (!timeZone.ok) {
    return timeZone;
  }

  const startResult = requireIsoDateTime(input.start, "range.start");
  if (!startResult.ok) {
    return startResult;
  }

  const endResult = requireIsoDateTime(input.end, "range.end");
  if (!endResult.ok) {
    return endResult;
  }

  if (parseRfc3339(startResult.value)! >= parseRfc3339(endResult.value)!) {
    return invalid("range.end must be after range.start");
  }

  return {
    ok: true,
    value: {
      calendar: calendar.value,
      end: endResult.value,
      kind: kind.value,
      start: startResult.value,
      timeZone: timeZone.value,
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
  if (!parseIsoDate(input.date)) {
    return invalid(`dailyMetrics[${index}].date must be YYYY-MM-DD`);
  }

  const record: DailyMetricRecord = { date: input.date };
  for (const [metric, value] of Object.entries(input)) {
    if (metric === "date") {
      continue;
    }
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

  const type = requireString(input.type, `samples[${index}].type`);
  if (!type.ok) {
    return type;
  }
  const unit = requireString(input.unit, `samples[${index}].unit`);
  if (!unit.ok) {
    return unit;
  }

  const intervalResult = validateInterval(input, `samples[${index}]`);
  if (!intervalResult.ok) {
    return intervalResult;
  }

  const idResult = validateOptionalId(input.id, `samples[${index}].id`);
  if (!idResult.ok) {
    return idResult;
  }

  if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
    return invalid(`samples[${index}].value must be a finite number`);
  }

  return {
    ok: true,
    value: {
      ...intervalResult.value,
      id: idResult.value,
      type: type.value,
      unit: unit.value,
      value: input.value,
    },
  };
}

function validateCategorySampleRecord(
  input: unknown,
  index: number,
): ValidationResultFor<CategorySampleRecord> {
  if (!isRecord(input)) {
    return invalid(`categorySamples[${index}] must be an object`);
  }

  const type = requireString(input.type, `categorySamples[${index}].type`);
  if (!type.ok) {
    return type;
  }
  const value = requireString(input.value, `categorySamples[${index}].value`);
  if (!value.ok) {
    return value;
  }

  const intervalResult = validateInterval(input, `categorySamples[${index}]`);
  if (!intervalResult.ok) {
    return intervalResult;
  }

  const idResult = validateOptionalId(input.id, `categorySamples[${index}].id`);
  if (!idResult.ok) {
    return idResult;
  }

  return {
    ok: true,
    value: {
      ...intervalResult.value,
      id: idResult.value,
      type: type.value,
      value: value.value,
    },
  };
}

function validateWorkoutRecord(input: unknown, index: number): ValidationResultFor<WorkoutRecord> {
  if (!isRecord(input)) {
    return invalid(`workouts[${index}] must be an object`);
  }

  const activityType = requireString(input.activityType, `workouts[${index}].activityType`);
  if (!activityType.ok) {
    return activityType;
  }

  const intervalResult = validateInterval(input, `workouts[${index}]`);
  if (!intervalResult.ok) {
    return intervalResult;
  }

  const idResult = validateOptionalId(input.id, `workouts[${index}].id`);
  if (!idResult.ok) {
    return idResult;
  }

  const duration = validateOptionalQuantity(input.duration, `workouts[${index}].duration`);
  if (!duration.ok) {
    return duration;
  }
  const activeEnergy = validateOptionalQuantity(
    input.activeEnergy,
    `workouts[${index}].activeEnergy`,
  );
  if (!activeEnergy.ok) {
    return activeEnergy;
  }
  const distance = validateOptionalQuantity(input.distance, `workouts[${index}].distance`);
  if (!distance.ok) {
    return distance;
  }

  return {
    ok: true,
    value: {
      ...intervalResult.value,
      activeEnergy: activeEnergy.value,
      activityType: activityType.value,
      distance: distance.value,
      duration: duration.value,
      id: idResult.value,
    },
  };
}

function validateSleepRecord(input: unknown, index: number): ValidationResultFor<SleepRecord> {
  if (!isRecord(input)) {
    return invalid(`sleep[${index}] must be an object`);
  }

  const value = requireString(input.value, `sleep[${index}].value`);
  if (!value.ok) {
    return value;
  }

  const intervalResult = validateInterval(input, `sleep[${index}]`);
  if (!intervalResult.ok) {
    return intervalResult;
  }

  const idResult = validateOptionalId(input.id, `sleep[${index}].id`);
  if (!idResult.ok) {
    return idResult;
  }

  return {
    ok: true,
    value: {
      ...intervalResult.value,
      id: idResult.value,
      value: value.value,
    },
  };
}

function validateOptionalArray<T>(
  input: unknown,
  name: string,
  validateItem: (item: unknown, index: number) => ValidationResultFor<T>,
): ValidationResultFor<Array<T>> {
  if (input === undefined) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(input)) {
    return invalid(`${name} must be an array when provided`);
  }

  const value: Array<T> = [];
  for (const [index, item] of input.entries()) {
    const result = validateItem(item, index);
    if (!result.ok) {
      return result;
    }
    value.push(result.value);
  }

  return { ok: true, value };
}

function validateOptionalId(input: unknown, path: string): ValidationResultFor<string | undefined> {
  if (input === undefined) {
    return { ok: true, value: undefined };
  }
  if (!nonEmptyString(input)) {
    return invalid(`${path} must be a non-empty string when provided`);
  }
  return { ok: true, value: input.trim() };
}

function validateOptionalStrings<K extends string>(
  input: Record<string, unknown>,
  prefix: string,
  keys: ReadonlyArray<K>,
): ValidationResultFor<Partial<Record<K, string>>> {
  const values: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = input[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string") {
      return invalid(`${prefix}.${key} must be a string when provided`);
    }
    values[key] = value;
  }

  return { ok: true, value: values };
}

function validateOptionalQuantity(
  input: unknown,
  path: string,
): ValidationResultFor<QuantityValue | undefined> {
  if (input === undefined) {
    return { ok: true, value: undefined };
  }
  if (!isQuantityValue(input)) {
    return invalid(`${path} must have numeric value and unit`);
  }
  return { ok: true, value: input };
}

function requireString(input: unknown, path: string): ValidationResultFor<string> {
  if (!nonEmptyString(input)) {
    return invalid(`${path} is required`);
  }
  return { ok: true, value: input };
}

function requireIsoDateTime(input: unknown, path: string): ValidationResultFor<string> {
  if (!nonEmptyString(input)) {
    return invalid(`${path} is required`);
  }

  if (parseRfc3339(input) === undefined) {
    return invalid(`${path} must be an RFC 3339 timestamp`);
  }

  return { ok: true, value: input };
}

function validateInterval(
  input: Record<string, unknown>,
  path: string,
): ValidationResultFor<{ end: string; start: string }> {
  const startResult = requireIsoDateTime(input.start, `${path}.start`);
  if (!startResult.ok) {
    return startResult;
  }

  const endResult = requireIsoDateTime(input.end, `${path}.end`);
  if (!endResult.ok) {
    return endResult;
  }

  if (parseRfc3339(startResult.value)! > parseRfc3339(endResult.value)!) {
    return invalid(`${path}.end must not be before ${path}.start`);
  }

  return { ok: true, value: { end: endResult.value, start: startResult.value } };
}

function validateContainedIntervals(
  records: Array<{ end: string; start: string }>,
  name: string,
  range: RangeInfo,
): ValidationResultFor<void> {
  const rangeStart = parseRfc3339(range.start)!;
  const rangeEnd = parseRfc3339(range.end)!;

  for (const [index, record] of records.entries()) {
    if (parseRfc3339(record.start)! < rangeStart || parseRfc3339(record.end)! > rangeEnd) {
      return invalid(`${name}[${index}] must be contained within range`);
    }
  }

  return { ok: true, value: undefined };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

type ValidationResultFor<T> = { ok: true; value: T } | { error: string; ok: false };

function invalid(error: string): ValidationFailure {
  return { error, ok: false };
}
