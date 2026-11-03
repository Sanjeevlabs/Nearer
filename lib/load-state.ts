/** What a screen that reads data should show right now. */
export type LoadView = "loading" | "failed" | "show";

/**
 * The one rule for every list: data already in hand always shows (a failed refresh
 * stays quiet); a read that failed with nothing to show says so (never an empty state);
 * otherwise loading is a skeleton, and a finished read shows (including its empty state).
 */
export function loadView({ loading, failed, hasData }: { loading: boolean; failed: boolean; hasData: boolean }): LoadView {
  if (hasData) return "show";
  if (failed) return "failed";
  return loading ? "loading" : "show";
}
