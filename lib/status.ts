// What is left of the old "Safe & sound" dot: a stored setting (hours before amber) that
// older clients still send. Nothing on screen reads it: availability and wellbeing are never
// inferred from when someone opened Nearer, the lamp, the clock or silence.

/** The stored default (window_view.quietAfterHours). */
export const QUIET_HOURS = 4;
export const QUIET_CHOICES = [2, 3, 4, 6, 8] as const;
