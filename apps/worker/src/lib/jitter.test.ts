import { jitter } from "./jitter";

describe("jitter(maxMs?)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── Critical ──────────────────────────────────────────────────────────────

  test("default delay uses maxMs=5000 and computes Math.floor(random * 5000)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    jitter();

    expect(setTimeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      Math.floor(0.5 * 5000) // 2500
    );
  });

  test("custom maxMs overrides the default", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    jitter(1000);

    expect(setTimeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      Math.floor(0.99 * 1000) // 990
    );
  });

  test("promise resolves to undefined after timer advances", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const promise = jitter(100);

    // Advance timers so the setTimeout callback fires
    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).resolves.toBeUndefined();
  });

  // ── Important ─────────────────────────────────────────────────────────────

  test("boundary: Math.random returns 0 produces delay of 0", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    jitter(5000);

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
  });

  test("boundary: Math.random near 1 produces delay strictly less than maxMs", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    jitter(5000);

    const delay = setTimeoutSpy.mock.calls[0]![1] as number;
    expect(delay).toBe(Math.floor(0.999 * 5000)); // 4995
    expect(delay).toBeLessThan(5000);
  });

  // ── Nice-to-have ──────────────────────────────────────────────────────────

  test("maxMs=0 produces delay of 0 and resolves immediately", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const promise = jitter(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
    await expect(promise).resolves.toBeUndefined();
  });

  test("negative maxMs produces delay <= 0 (Node treats as immediate)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const promise = jitter(-1);
    await vi.advanceTimersByTimeAsync(0);

    // Math.floor(0.5 * -1) = Math.floor(-0.5) = -1
    // Node setTimeout with negative delay acts like 0
    const delay = setTimeoutSpy.mock.calls[0]![1] as number;
    expect(delay).toBeLessThanOrEqual(0);
    await expect(promise).resolves.toBeUndefined();
  });
});
