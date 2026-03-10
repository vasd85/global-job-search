import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import Link from "next/link";

const VENDOR_COLORS: Record<string, string> = {
  greenhouse:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  lever: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  ashby: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  smartrecruiters:
    "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
};

const STATUS_COLORS: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  error: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  empty:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  not_found: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
};

export default async function CompaniesPage() {
  const result = await db
    .select({
      id: companies.id,
      slug: companies.slug,
      name: companies.name,
      website: companies.website,
      industry: companies.industry,
      atsVendor: companies.atsVendor,
      isActive: companies.isActive,
      lastPolledAt: companies.lastPolledAt,
      lastPollStatus: companies.lastPollStatus,
      jobsCount: companies.jobsCount,
    })
    .from(companies)
    .orderBy(desc(companies.jobsCount));

  const totalJobs = result.reduce((sum, c) => sum + c.jobsCount, 0);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            >
              ← Jobs
            </Link>
            <span className="text-zinc-300 dark:text-zinc-700">/</span>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">
              Companies
            </h1>
          </div>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {result.length} companies · {totalJobs.toLocaleString()} open jobs
          </p>
        </div>
      </header>

      {/* Table */}
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Company
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  ATS
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Jobs
                </th>
                <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 md:table-cell">
                  Last polled
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {result.map((company) => {
                const polledAt = company.lastPolledAt
                  ? new Date(company.lastPolledAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : null;

                return (
                  <tr
                    key={company.id}
                    className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                  >
                    {/* Name */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-900 dark:text-white">
                        {company.website ? (
                          <a
                            href={company.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-blue-600 dark:hover:text-blue-400"
                          >
                            {company.name}
                          </a>
                        ) : (
                          company.name
                        )}
                      </div>
                      {company.industry && company.industry.length > 0 && (
                        <div className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                          {company.industry.slice(0, 3).join(" · ")}
                        </div>
                      )}
                    </td>

                    {/* ATS vendor badge */}
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                          VENDOR_COLORS[company.atsVendor] ??
                          "bg-zinc-100 text-zinc-600 dark:bg-zinc-800"
                        }`}
                      >
                        {company.atsVendor}
                      </span>
                    </td>

                    {/* Job count — links to search filtered by company */}
                    <td className="px-4 py-3 text-right">
                      {company.jobsCount > 0 ? (
                        <Link
                          href={`/?company=${company.slug}&companyName=${encodeURIComponent(company.name)}`}
                          className="font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          {company.jobsCount}
                        </Link>
                      ) : (
                        <span className="text-zinc-400">0</span>
                      )}
                    </td>

                    {/* Last polled */}
                    <td className="hidden px-4 py-3 text-zinc-500 dark:text-zinc-400 md:table-cell">
                      {polledAt ?? (
                        <span className="text-zinc-300 dark:text-zinc-600">
                          Never
                        </span>
                      )}
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_COLORS[company.lastPollStatus ?? ""] ??
                          "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                        }`}
                      >
                        {company.lastPollStatus ?? "pending"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
