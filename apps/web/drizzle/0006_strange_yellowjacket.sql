CREATE TABLE "synonym_group" (
	"id" serial PRIMARY KEY NOT NULL,
	"dimension" text NOT NULL,
	"canonical" text NOT NULL,
	"synonyms" text[] NOT NULL,
	"umbrella_key" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_synonym_dimension_canonical" ON "synonym_group" USING btree ("dimension","canonical");--> statement-breakpoint
CREATE INDEX "idx_synonym_dimension" ON "synonym_group" USING btree ("dimension");