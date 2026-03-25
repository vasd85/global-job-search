CREATE TABLE "conversation_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_state_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "role_family" ALTER COLUMN "strong_match" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "role_family" ALTER COLUMN "moderate_match" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "role_family" ALTER COLUMN "department_boost" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "role_family" ALTER COLUMN "department_exclude" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_conversation_state_id_conversation_state_id_fk" FOREIGN KEY ("conversation_state_id") REFERENCES "public"."conversation_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_state" ADD CONSTRAINT "conversation_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_message_state_idx" ON "conversation_message" USING btree ("conversation_state_id");--> statement-breakpoint
CREATE INDEX "conversation_message_created_idx" ON "conversation_message" USING btree ("conversation_state_id","created_at");