const METRICS_PREFIX = 'MAPSOO_PI4_PHYSICAL_METRICS ';

export const PI4_ACCEPTANCE_THRESHOLDS = Object.freeze({
  minimum_average_fps: 24,
  maximum_p95_frame_ms: 66.667,
  maximum_peak_static_memory_bytes: 1_610_612_736,
  maximum_peak_rss_bytes: 1_610_612_736,
  maximum_temperature_c: 85,
  maximum_startup_ms: 30_000,
});

function boundedNumber(value, minimum, maximum, label, integer = false) {
  const number = Number(value);
  if (!Number.isFinite(number)
      || number < minimum
      || number > maximum
      || (integer && !Number.isSafeInteger(number))) {
    throw new Error(`${label} is outside its accepted range.`);
  }
  return number;
}

export function parsePi4Metrics(output) {
  const lines = String(output).split(/\r?\n/u);
  const matches = lines.filter((line) => line.startsWith(METRICS_PREFIX));
  if (matches.length !== 1) {
    throw new Error('Godot must emit exactly one physical metrics marker.');
  }
  const fields = Object.fromEntries(
    matches[0].slice(METRICS_PREFIX.length).split(' ').map((token) => {
      const separator = token.indexOf('=');
      if (separator <= 0 || separator === token.length - 1) {
        throw new Error('Physical metrics marker contains an invalid token.');
      }
      return [token.slice(0, separator), token.slice(separator + 1)];
    }),
  );
  const expected = [
    'average_fps',
    'frames',
    'observation_ms',
    'p95_frame_ms',
    'peak_static_memory_bytes',
  ];
  if (JSON.stringify(Object.keys(fields).sort()) !== JSON.stringify(expected)) {
    throw new Error('Physical metrics marker fields are not exact.');
  }
  return Object.freeze({
    observation_ms: boundedNumber(
      fields.observation_ms, 30_000, 900_000, 'Observation duration', true,
    ),
    frames: boundedNumber(fields.frames, 1, 5_400_000, 'Observed frame count', true),
    average_fps: boundedNumber(fields.average_fps, 0, 1_000, 'Average FPS'),
    p95_frame_ms: boundedNumber(fields.p95_frame_ms, 0, 10_000, 'P95 frame time'),
    peak_static_memory_bytes: boundedNumber(
      fields.peak_static_memory_bytes,
      1,
      4_294_967_296,
      'Peak static memory',
      true,
    ),
  });
}

export function assertPi4Performance(metrics, temperatures, startupMs) {
  const peakTemperature = Math.max(...temperatures);
  const failures = [];
  if (metrics.average_fps < PI4_ACCEPTANCE_THRESHOLDS.minimum_average_fps) {
    failures.push('average FPS');
  }
  if (metrics.p95_frame_ms > PI4_ACCEPTANCE_THRESHOLDS.maximum_p95_frame_ms) {
    failures.push('P95 frame time');
  }
  if (metrics.peak_static_memory_bytes
      > PI4_ACCEPTANCE_THRESHOLDS.maximum_peak_static_memory_bytes) {
    failures.push('peak static memory');
  }
  if (metrics.peak_rss_bytes !== undefined
      && metrics.peak_rss_bytes > PI4_ACCEPTANCE_THRESHOLDS.maximum_peak_rss_bytes) {
    failures.push('peak RSS');
  }
  if (peakTemperature > PI4_ACCEPTANCE_THRESHOLDS.maximum_temperature_c) {
    failures.push('temperature');
  }
  if (startupMs > PI4_ACCEPTANCE_THRESHOLDS.maximum_startup_ms) {
    failures.push('startup time');
  }
  if (failures.length) {
    throw new Error(`Physical acceptance thresholds failed: ${failures.join(', ')}.`);
  }
  return peakTemperature;
}
