import type { Job } from "pg-boss";

// Mock @gjs/logger before importing the module under test so the module
// binds to the mock logger. Hoist the shared mockLog so tests keep a stable
// reference even across `vi.clearAllMocks()` or `vi.restoreAllMocks()`.
const { mockLog } = vi.hoisted(() => ({
  mockLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    child: vi.fn(function (this: unknown) {
      return this;
    }),
    flush: vi.fn((cb?: () => void) => cb?.()),
    level: "info",
  },
}));

vi.mock("@gjs/logger", () => ({
  createLogger: vi.fn(() => mockLog),
}));

import {
  handleDescriptionFetch,
  handleRoleTaxonomy,
} from "./stubs";

/** Helper to create a minimal pg-boss Job object with a given id. */
function makeJob(id: string): Job {
  return { id, name: "test-queue", data: {} } as Job;
}

describe("stub handlers", () => {
  beforeEach(() => {
    mockLog.info.mockClear();
    mockLog.warn.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Important: each stub logs job IDs and resolves ──────────────────────

  test.each<{
    name: string;
    handler: (jobs: Job[]) => Promise<void>;
    handlerTag: string;
  }>([
    { name: "handleDescriptionFetch", handler: handleDescriptionFetch, handlerTag: "descriptionFetch" },
    { name: "handleRoleTaxonomy", handler: handleRoleTaxonomy, handlerTag: "roleTaxonomy" },
  ])("$name logs each job ID and resolves without throwing", async ({ handler, handlerTag }) => {
    const jobs = [makeJob("job-1"), makeJob("job-2")];

    await expect(handler(jobs)).resolves.toBeUndefined();

    // Deliberate level change per plan: stub invocations are logged at `warn`
    // (not `info`) so an unimplemented queue firing in prod produces an
    // operator alert instead of background noise.
    expect(mockLog.warn).toHaveBeenCalledTimes(2);
    expect(mockLog.warn).toHaveBeenCalledWith(
      { jobId: "job-1", handler: handlerTag },
      "Stub handler invoked",
    );
    expect(mockLog.warn).toHaveBeenCalledWith(
      { jobId: "job-2", handler: handlerTag },
      "Stub handler invoked",
    );
  });

  // ── Nice-to-have: empty jobs array ─────────────────────────────────────

  test.each<{
    name: string;
    handler: (jobs: Job[]) => Promise<void>;
  }>([
    { name: "handleDescriptionFetch", handler: handleDescriptionFetch },
    { name: "handleRoleTaxonomy", handler: handleRoleTaxonomy },
  ])("$name handles empty jobs array without error", async ({ handler }) => {
    await expect(handler([])).resolves.toBeUndefined();

    expect(mockLog.warn).not.toHaveBeenCalled();
    expect(mockLog.info).not.toHaveBeenCalled();
  });
});
