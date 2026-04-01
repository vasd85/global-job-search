/** Returns a promise that resolves after a random delay between 0 and maxMs. */
export function jitter(maxMs: number = 5000): Promise<void> {
  const delay = Math.floor(Math.random() * maxMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}
