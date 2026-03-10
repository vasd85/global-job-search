import { Suspense } from "react";
import { JobSearch } from "@/components/job-search";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center">
            <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-blue-500 border-t-transparent" />
          </div>
        }
      >
        <JobSearch />
      </Suspense>
    </div>
  );
}
