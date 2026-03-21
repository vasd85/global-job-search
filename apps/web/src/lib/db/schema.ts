import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
  index,
  real,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer): Buffer {
    return value;
  },
  fromDriver(value: Buffer): Buffer {
    return Buffer.from(value);
  },
});

// ─── auth: user ─────────────────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── auth: session ──────────────────────────────────────────────────────────

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  impersonatedBy: text("impersonated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── auth: account ──────────────────────────────────────────────────────────

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── auth: verification ─────────────────────────────────────────────────────

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── company ────────────────────────────────────────────────────────────────

export const companies = pgTable(
  "company",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    website: text("website"),
    industry: text("industry").array(),

    atsVendor: text("ats_vendor").notNull(), // greenhouse | lever | ashby | smartrecruiters
    atsSlug: text("ats_slug").notNull(),
    atsCareersUrl: text("ats_careers_url"),

    source: text("source").notNull().default("seed_list"), // seed_list | user_submission | auto_discovered
    isActive: boolean("is_active").notNull().default(true),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastPollStatus: text("last_poll_status"), // ok | error | empty | not_found
    lastPollError: text("last_poll_error"),
    jobsCount: integer("jobs_count").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("company_ats_vendor_slug_idx").on(table.atsVendor, table.atsSlug),
  ]
);

// ─── job ────────────────────────────────────────────────────────────────────

export const jobs = pgTable(
  "job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    atsJobId: text("ats_job_id").notNull(),
    jobUid: text("job_uid").notNull().unique(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    locationRaw: text("location_raw"),
    departmentRaw: text("department_raw"),
    postedDateRaw: text("posted_date_raw"),
    employmentTypeRaw: text("employment_type_raw"),
    descriptionText: text("description_text"),
    salaryRaw: text("salary_raw"),
    workplaceType: text("workplace_type"), // remote | hybrid | onsite
    applyUrl: text("apply_url"),

    descriptionHash: text("description_hash"),

    status: text("status").notNull().default("open"), // open | stale | closed
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    contentUpdatedAt: timestamp("content_updated_at", { withTimezone: true }),

    sourceType: text("source_type").notNull().default("ats_api"),
    sourceRef: text("source_ref").notNull(),
    sourceRaw: jsonb("source_raw"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("job_company_ats_job_id_idx").on(table.companyId, table.atsJobId),
    index("job_status_idx").on(table.status),
    index("job_first_seen_idx").on(table.firstSeenAt),
    index("job_company_id_idx").on(table.companyId),
  ]
);

// ─── user_profile ───────────────────────────────────────────────────────────

export const userProfiles = pgTable("user_profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),

  targetTitles: text("target_titles").array(),
  targetSeniority: text("target_seniority").array(),

  primarySkills: text("primary_skills").array(),
  secondarySkills: text("secondary_skills").array(),
  yearsExperience: integer("years_experience"),

  preferredLocations: text("preferred_locations").array(),
  remotePreference: text("remote_preference").default("any"), // remote_only | hybrid_ok | onsite_ok | any
  minSalary: integer("min_salary"),
  preferredIndustries: text("preferred_industries").array(),

  weightMobility: real("weight_mobility").notNull().default(0.3),
  weightDomain: real("weight_domain").notNull().default(0.15),
  weightSkills: real("weight_skills").notNull().default(0.25),
  weightCompensation: real("weight_compensation").notNull().default(0.3),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── user_api_key ──────────────────────────────────────────────────────────

export const userApiKeys = pgTable(
  "user_api_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // anthropic
    ciphertext: bytea("ciphertext").notNull(),
    iv: bytea("iv").notNull(),
    authTag: bytea("auth_tag").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    status: text("status").notNull().default("active"), // active | invalid | revoked
    maskedHint: text("masked_hint"),
    fingerprintHmac: text("fingerprint_hmac").notNull(),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("user_api_key_active_idx")
      .on(table.userId, table.provider)
      .where(sql`status = 'active'`),
    index("user_api_key_user_idx").on(table.userId),
  ]
);

// ─── job_match ──────────────────────────────────────────────────────────────

export const jobMatches = pgTable(
  "job_match",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userProfileId: uuid("user_profile_id")
      .notNull()
      .references(() => userProfiles.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    scoreM: integer("score_m"), // Mobility
    scoreD: integer("score_d"), // Domain
    scoreS: integer("score_s"), // Skills
    scoreC: integer("score_c"), // Compensation
    matchPercent: integer("match_percent"),

    matchReason: text("match_reason"),
    evidenceQuotes: text("evidence_quotes").array(),

    userStatus: text("user_status").notNull().default("new"), // new | saved | applied | dismissed
    userNotes: text("user_notes"),

    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
    jobContentHash: text("job_content_hash"),
    isStale: boolean("is_stale").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("job_match_profile_job_idx").on(table.userProfileId, table.jobId),
    index("job_match_score_idx").on(table.userProfileId, table.matchPercent),
    index("job_match_status_idx").on(table.userProfileId, table.userStatus),
  ]
);

// ─── poll_log ───────────────────────────────────────────────────────────────

export const pollLogs = pgTable(
  "poll_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    polledAt: timestamp("polled_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull(), // ok | error | empty | not_found
    jobsFound: integer("jobs_found").default(0),
    jobsNew: integer("jobs_new").default(0),
    jobsClosed: integer("jobs_closed").default(0),
    jobsUpdated: integer("jobs_updated").default(0),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    index("poll_log_company_idx").on(table.companyId),
    index("poll_log_polled_at_idx").on(table.polledAt),
  ]
);

// ─── company_submission ─────────────────────────────────────────────────────

export const companySubmissions = pgTable("company_submission", {
  id: uuid("id").primaryKey().defaultRandom(),
  submittedBy: text("submitted_by"),
  companyName: text("company_name").notNull(),
  companyWebsite: text("company_website"),
  atsCareersUrl: text("ats_careers_url"),

  status: text("status").notNull().default("pending"), // pending | approved | rejected | duplicate
  resolvedCompanyId: uuid("resolved_company_id").references(() => companies.id),
  resolvedAtsVendor: text("resolved_ats_vendor"),
  resolvedAtsSlug: text("resolved_ats_slug"),
  reviewerNotes: text("reviewer_notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});
