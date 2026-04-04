import type { Job } from "pg-boss";
import {
  handleDescriptionFetch,
  handleRoleTaxonomy,
} from "./stubs";

/** Helper to create a minimal pg-boss Job object with a given id. */
function makeJob(id: string): Job {
  return { id, name: "test-queue", data: {} } as Job;
}

describe("stub handlers", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Important: each stub logs job IDs and resolves ──────────────────────

  test.each<{
    name: string;
    handler: (jobs: Job[]) => Promise<void>;
    prefix: string;
  }>([
    { name: "handleDescriptionFetch", handler: handleDescriptionFetch, prefix: "Description fetch" },
    { name: "handleRoleTaxonomy", handler: handleRoleTaxonomy, prefix: "Role taxonomy" },
  ])("$name logs each job ID and resolves without throwing", async ({ handler, prefix }) => {
    const jobs = [makeJob("job-1"), makeJob("job-2")];

    await expect(handler(jobs)).resolves.toBeUndefined();

    expect(infoSpy).toHaveBeenCalledTimes(2);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("job-1")
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("job-2")
    );
    // Verify the prefix identifies which stub is logging
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining(prefix)
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

    expect(infoSpy).not.toHaveBeenCalled();
  });
});
