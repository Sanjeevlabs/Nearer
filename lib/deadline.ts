// Wait for something slow, but not forever: the answer if it arrives within
// `ms`, else `fallback`. The slow work is not cancelled (a late result still
// lands in whatever cache it fills); it just stops holding up the response.
export function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((res) => {
    timer = setTimeout(() => res(fallback), ms);
  });
  return Promise.race([p.catch(() => fallback), late]).finally(() => clearTimeout(timer));
}
