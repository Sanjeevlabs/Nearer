// A tiny counter of database round trips, so a slow endpoint can be explained
// in numbers (and a test can hold it to a budget). Module-level on purpose:
// routes and tests reset it, then read it at the end. Not request-safe under
// concurrent traffic; it is a measuring stick, never used for logic.
let calls = 0;
let by: Record<string, number> = {};

export function resetDbStats(): void {
  calls = 0;
  by = {};
}

export function countDbCall(table: string): void {
  calls++;
  by[table] = (by[table] ?? 0) + 1;
}

export function readDbStats(): { calls: number; byTable: Record<string, number> } {
  return { calls, byTable: { ...by } };
}
