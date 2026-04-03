import { z } from "zod";

/**
 * Schema for a single company returned by the AI discovery web search.
 *
 * No strict URL validation on website/careersUrl — the AI may return
 * slightly malformed URLs that we can still parse. Validation happens
 * downstream (normalizeDomain, detectAtsVendor).
 */
export const DiscoveredCompanySchema = z.object({
  name: z.string().describe("Company name"),
  website: z.string().describe("Company website URL"),
  careersUrl: z
    .string()
    .nullable()
    .describe("Careers/jobs page URL if found, null otherwise"),
  industry: z.array(z.string()).describe("Industry tags for this company"),
  reasoning: z
    .string()
    .describe("Brief explanation of why this company matches the criteria"),
});

/**
 * Top-level schema for the structured AI discovery output.
 */
export const DiscoveryOutputSchema = z.object({
  companies: z.array(DiscoveredCompanySchema),
});

export type DiscoveredCompany = z.infer<typeof DiscoveredCompanySchema>;
export type DiscoveryOutput = z.infer<typeof DiscoveryOutputSchema>;
