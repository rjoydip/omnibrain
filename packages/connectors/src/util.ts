/** Small concurrency pool so outbound fetches stay within provider rate limits. */
export async function mapLimited<T, R>(
  values: T[],
  limit: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      out[index] = await fn(values[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}
