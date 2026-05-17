export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const runWorker = async () => {
    while (currentIndex < items.length) {
      const nextIndex = currentIndex;
      if (nextIndex >= items.length) {
        return;
      }

      currentIndex += 1;
      results[nextIndex] = await mapper(items[nextIndex], nextIndex);
    }
  };

  const workerCount = Math.min(safeConcurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results;
}
