import type { AtsVendor } from "../types";

/** ATS vendors with working extractors and public APIs. */
export const SUPPORTED_ATS_VENDORS = ["greenhouse", "lever", "ashby", "smartrecruiters"] as const;
export type SupportedAtsVendor = (typeof SUPPORTED_ATS_VENDORS)[number];

export function detectAtsVendor(url: string | null): AtsVendor {
  if (!url) {
    return "unknown";
  }
  let host = "";
  let path = "";
  let search = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname.toLowerCase();
    search = parsed.search.toLowerCase();
  } catch {
    return "unknown";
  }
  if (/[?&]gh_jid=/.test(search)) {
    return "greenhouse";
  }
  if (/[?&]ashby_jid=/.test(search)) {
    return "ashby";
  }
  if (host.includes("greenhouse.io")) {
    return "greenhouse";
  }
  if (host.includes("lever.co")) {
    return "lever";
  }
  if (host.includes("ashbyhq.com")) {
    return "ashby";
  }
  if (host.includes("workable.com")) {
    return "workable";
  }
  if (host.includes("smartrecruiters.com")) {
    return "smartrecruiters";
  }
  if (host.includes("teamtailor.com")) {
    return "teamtailor";
  }
  if (host.includes("personio.com")) {
    return "personio";
  }
  if (
    host.includes("workdayjobs.com") ||
    host.includes("myworkdayjobs.com") ||
    path.includes("/wday/cxs/")
  ) {
    return "workday";
  }
  if (host.includes("bamboohr.com")) {
    return "bamboohr";
  }
  if (host.includes("breezy.hr")) {
    return "breezy";
  }
  return "unknown";
}

export function isAtsHost(url: string): boolean {
  return detectAtsVendor(url) !== "unknown";
}

export function isKnownAtsVendor(vendor: AtsVendor): boolean {
  return vendor !== "unknown" && vendor !== "custom";
}
