import { z } from "zod";

/** Validation schema for search query parameters (pagination only). */
export const SearchQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type SearchQueryParams = z.infer<typeof SearchQuerySchema>;
