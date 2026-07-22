export async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  maxWorkers: number,
  mapper: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 16) {
    throw new Error("Worker count must be an integer between 1 and 16.");
  }
  const results = new Array<Output>(items.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await mapper(item, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxWorkers, items.length) }, () => worker()));
  return results;
}
