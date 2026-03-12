"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

export type Job = {
  id: string;
  title: string;
  url: string;
  locationRaw: string | null;
  departmentRaw: string | null;
  workplaceType: string | null;
  salaryRaw: string | null;
  firstSeenAt: string;
  applyUrl: string | null;
  sourceRef: string;
  companyName: string;
  companySlug: string;
};

type JobsResponse = {
  jobs: Job[];
  total: number;
  limit: number;
  offset: number;
};

const LIMIT = 50;

const WORKPLACE_COLORS: Record<string, string> = {
  remote:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  hybrid:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  onsite: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
};

export function JobSearch() {
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [workplaceType, setWorkplaceType] = useState(
    searchParams.get("workplaceType") ?? ""
  );
  const [vendor, setVendor] = useState(searchParams.get("vendor") ?? "");
  const [companySlug, setCompanySlug] = useState(
    searchParams.get("company") ?? ""
  );
  const [companyName, setCompanyName] = useState(
    searchParams.get("companyName") ?? ""
  );
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<JobsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchJobs = useCallback(
    async (params: {
      search: string;
      workplaceType: string;
      vendor: string;
      companySlug: string;
      offset: number;
    }) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (params.search) qs.set("search", params.search);
        if (params.workplaceType) qs.set("workplaceType", params.workplaceType);
        if (params.vendor) qs.set("vendor", params.vendor);
        if (params.companySlug) qs.set("company", params.companySlug);
        qs.set("limit", String(LIMIT));
        qs.set("offset", String(params.offset));

        const res = await fetch(`/api/jobs?${qs}`);
        const json = (await res.json()) as JobsResponse;
        setData(json);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Debounced refetch when filters change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setOffset(0);
      fetchJobs({ search, workplaceType, vendor, companySlug, offset: 0 });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, workplaceType, vendor, companySlug]);

  const changePage = useCallback(
    (newOffset: number) => {
      setOffset(newOffset);
      fetchJobs({ search, workplaceType, vendor, companySlug, offset: newOffset });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [search, workplaceType, vendor, companySlug, fetchJobs]
  );

  const clearCompany = useCallback(() => {
    setCompanySlug("");
    setCompanyName("");
  }, []);

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0;
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <>
      {/* Sticky header with search */}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">
              🌍 Global Job Search
            </h1>
            <a
              href="/companies"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            >
              Companies →
            </a>
          </div>

          {/* Search bar */}
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Search by title or department..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder:text-zinc-500 dark:focus:ring-blue-900"
            />
            <select
              value={workplaceType}
              onChange={(e) => setWorkplaceType(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              <option value="">All locations</option>
              <option value="remote">🌐 Remote</option>
              <option value="hybrid">🏢 Hybrid</option>
              <option value="onsite">📍 Onsite</option>
            </select>
            <select
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              <option value="">All ATS</option>
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
            </select>
          </div>

          {/* Active company filter chip */}
          {companySlug && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Company:</span>
              <span className="flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                {companyName || companySlug}
                <button
                  onClick={clearCompany}
                  className="ml-0.5 text-blue-400 hover:text-blue-700 dark:hover:text-blue-200"
                  aria-label="Clear company filter"
                >
                  ✕
                </button>
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Stats row */}
        <div className="mb-4 flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
          <span>
            {loading
              ? "Loading…"
              : data
                ? `${data.total.toLocaleString()} jobs found`
                : ""}
          </span>
          {totalPages > 1 && (
            <span>
              Page {currentPage} of {totalPages}
            </span>
          )}
        </div>

        {/* Spinner overlay */}
        {loading && (
          <div className="flex justify-center py-16">
            <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-blue-500 border-t-transparent" />
          </div>
        )}

        {/* Job list */}
        {!loading && (
          <div className="space-y-3">
            {data?.jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
            {data?.jobs.length === 0 && (
              <div className="rounded-xl border border-zinc-200 bg-white py-16 text-center text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
                No jobs found. Try different search terms.
              </div>
            )}
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-2">
            <button
              onClick={() => changePage(Math.max(0, offset - LIMIT))}
              disabled={offset === 0}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm transition-colors disabled:opacity-40 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              ← Prev
            </button>
            <span className="px-3 text-sm text-zinc-500">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => changePage(offset + LIMIT)}
              disabled={offset + LIMIT >= (data?.total ?? 0)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm transition-colors disabled:opacity-40 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Next →
            </button>
          </div>
        )}
      </main>
    </>
  );
}

function JobCard({ job }: { job: Job }) {
  const postedDate = new Date(job.firstSeenAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const applyHref = job.applyUrl ?? job.url;

  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Company + department */}
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {job.companyName}
            </span>
            {job.departmentRaw && (
              <span className="text-zinc-400 dark:text-zinc-500">
                · {job.departmentRaw}
              </span>
            )}
          </div>

          {/* Title */}
          <h2 className="mt-0.5 text-base font-semibold leading-snug text-zinc-900 dark:text-white">
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-blue-600 dark:hover:text-blue-400"
            >
              {job.title}
            </a>
          </h2>

          {/* Meta tags */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            {job.locationRaw && (
              <span>
                📍 <span>{job.locationRaw}</span>
              </span>
            )}
            {job.workplaceType && (
              <span
                className={`rounded-full px-2 py-0.5 font-medium capitalize ${
                  WORKPLACE_COLORS[job.workplaceType] ??
                  "bg-zinc-100 text-zinc-600 dark:bg-zinc-800"
                }`}
              >
                {job.workplaceType}
              </span>
            )}
            {job.salaryRaw && <span>💰 {job.salaryRaw}</span>}
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <span>Added {postedDate}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <a
            href={applyHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 active:bg-blue-800"
          >
            Apply →
          </a>
          <span className="text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
            {job.sourceRef}
          </span>
        </div>
      </div>
    </article>
  );
}
