# Research: Chatbot Technology

Status: Draft | Date: 2026-03-19

---

## 1. Goal

This document evaluates technology options for the preferences-collection chatbot in `global-job-search`.

The chatbot is a core UX surface, but it is not a general-purpose agent. Its job is to help the user build a structured preferences profile for:

- company preferences
- job preferences
- role taxonomy expansion when needed

This document focuses on the implementation strategy for that chatbot and the LLM/provider layer behind it.

---

## 2. Product Context

Based on `docs/business-logic-job-search.md` and related architecture decisions, the chatbot must work within these constraints:

- The app collects a fixed set of typed preference fields with required and optional rules.
- The conversation must eventually produce a reliable structured profile, not just a transcript.
- Some inputs are natural-language and ambiguous, but many fields are enums, arrays, weights, or hard constraints.
- The product is starting with `Anthropic`.
- The architecture must allow future providers such as `OpenAI` and `Google`.
- The product already assumes `BYOK` and server-side async workflows, so provider integration must fit server-side control and persistence.

This means the main technical problem is not "how to build a generic AI chat". The real problem is "how to build a deterministic preference collection flow with selective LLM assistance".

---

## 3. Non-Negotiable Decisions

The following decisions should be treated as architecture rules:

- The application controls the dialogue state and decides the next step.
- The canonical state is a structured preferences draft, not the chat transcript.
- The LLM has strictly limited responsibilities.
- The provider layer must be replaceable.
- The chatbot must remain usable even when the model output is imperfect or temporarily unavailable.

### 3.1 What the LLM is allowed to do

- Parse free-text answers into typed partial preferences
- Normalize synonyms and fuzzy user input
- Propose clarifying questions when input is ambiguous
- Summarize the current draft back to the user
- Propose taxonomy expansions for unknown role families or categories

### 3.2 What the LLM must not control

- The next required field or conversation step
- Whether required fields can be skipped
- Direct writes to the canonical preferences record
- Silent creation of new enum values without confirmation
- Final validation of hard business rules on its own

---

## 4. Evaluation Of The Original Options

## 4.1 Vercel AI SDK

### What it is

A unified TypeScript SDK for LLM providers with streaming, structured output, tool calling, and React/Next.js integration.

Important distinction:

- `AI SDK Core` is the provider abstraction and generation layer.
- `AI SDK UI` is the chat transport and streaming UI layer.

These should not be treated as the same architectural decision.

### Pros

- Excellent fit for `Next.js`
- Strong multi-provider story across `Anthropic`, `OpenAI`, and `Google`
- Structured output support with schema validation
- Streaming support if the chatbot needs conversational polish
- Good long-term flexibility if the product later expands beyond `Anthropic`
- Cleaner migration path than writing directly against one provider SDK everywhere

### Cons

- It does not solve dialogue management by itself
- `useChat` can tempt the team into a model-driven conversation loop, which is not the right architecture here
- Some advanced streaming or resume features add storage and infrastructure complexity
- Provider-specific features may still require adapter-level escapes

### Project fit

`AI SDK Core` is one of the best fits for this repository because it provides a clean multi-provider abstraction without forcing a model-controlled chat architecture.

`AI SDK UI` is optional. It is useful only if the team wants richer streaming chat UX. It should not become the source of truth for conversation state.

### Verdict

Recommended as the default provider abstraction layer.

Do not use it as a substitute for the app-owned conversation engine.

## 4.2 Direct `@anthropic-ai/sdk`

### What it is

Anthropic's provider-specific TypeScript SDK with direct access to streaming, tool use, and structured outputs.

### Pros

- Maximum control over Anthropic-specific features
- Fast access to new Claude capabilities
- Good structured output support
- Good choice for low-level optimization or provider-specific behavior

### Cons

- Creates direct coupling to a single provider
- Makes future `OpenAI` and `Google` support more expensive to add
- Requires more custom work for transport and abstraction
- Encourages vendor-specific logic to leak into application code

### Project fit

Good for an `Anthropic`-only system. Not the strongest default for a system that already knows it will need multiple providers later.

### Verdict

Not recommended as the primary app-facing abstraction.

Still useful as an adapter-level escape hatch if one Anthropic-specific capability becomes important enough.

## 4.3 Structured Flow Without LLM

### What it is

A deterministic multi-step flow with standard validation and no model in the critical path.

### Pros

- Fastest and cheapest option
- Fully predictable
- Best for required fields, enums, numeric ranges, and validation
- Excellent analytics and debugging story
- Very strong fit for canonical preference state

### Cons

- Pure forms can feel less conversational
- Natural-language input requires extra parsing logic if AI is not used at all
- Harder to support free-form user responses elegantly without some AI assistance

### Project fit

This is not merely a fallback option. It is the correct backbone for this application.

### Verdict

Recommended as the foundation of the chatbot architecture.

---

## 5. Better Framing: Three Separate Layers

The original comparison mixes three different concerns:

1. Dialogue management
2. Provider/model integration
3. UI and streaming transport

They should be designed independently.

### 5.1 Dialogue Management Layer

Owns:

- current step
- required vs optional fields
- branching logic
- validation
- completion rules
- confirmation and correction flows

This layer must be deterministic and application-owned.

### 5.2 Provider Layer

Owns:

- structured extraction from free text
- short text generation
- taxonomy proposals
- provider routing and model selection

This layer must be replaceable and isolated behind adapters.

### 5.3 UI Layer

Owns:

- chat-like presentation
- structured controls
- message rendering
- streaming display if needed

This layer is allowed to look like a chatbot, but it must not be the source of truth for workflow state.

---

## 6. Better Options Not In The Original List

## 6.1 `Zod` As The Canonical Schema Layer

This is the most important missing piece from the original list.

The chatbot should have one canonical typed schema for the preferences draft. Every input path should ultimately map into that schema.

Why it matters:

- Keeps deterministic validation in app code
- Gives one source of truth for both UI and LLM extraction
- Makes provider swapping much easier
- Reduces parsing ambiguity

Verdict:

Strongly recommended.

## 6.2 `React Hook Form` For Structured Controls

This is useful even in a chat-style experience because many answers are not best represented as free text.

Good fit for:

- multi-select chips
- salary controls
- location selectors
- weights
- review and edit screens

Verdict:

Recommended for the structured parts of the UX.

## 6.3 `XState` For Conversation State

`XState` is not mandatory on day one, but it is one of the best options if the onboarding flow becomes deeply branched or interruptible.

Good fit for:

- deterministic next-step logic
- backtracking and corrections
- resumable drafts
- explicit state transitions
- complex branching and recovery

Trade-off:

- More upfront modeling effort than a simple step config

Verdict:

Recommended if branching complexity grows beyond a simple linear or lightly branched flow.

## 6.4 `assistant-ui`

A stronger UI layer for chat interfaces on top of `Vercel AI SDK`.

Good fit for:

- polished chat UX
- richer thread rendering
- future assistant-like product surfaces

Trade-off:

- It improves the UI layer, not the underlying workflow design

Verdict:

Optional enhancement, not a core architecture decision.

## 6.5 `LangGraph.js`

A workflow and agent framework with persistence, streaming, and stateful execution.

Why it is less attractive here:

- The chatbot does not need autonomous agent behavior
- The critical path is deterministic slot filling, not multi-step reasoning autonomy
- It adds framework surface area that does not clearly improve the first implementation

Verdict:

Interesting for future agentic workflows, but overkill for the initial preference-collection chatbot.

## 6.6 `Mastra`

A TypeScript agent and workflow framework with memory and storage features.

Why it is less attractive here:

- Similar overkill risk as `LangGraph`
- More framework dependency than the product currently needs
- The main problem is controlled onboarding, not durable general-purpose agents

Verdict:

Not a strong first choice for this use case.

---

## 7. Recommended Architecture

## 7.1 Short Version

Recommended architecture:

- app-owned dialogue engine
- canonical `Zod` preferences schema
- selective LLM assistance only for free-text interpretation and taxonomy help
- `Vercel AI SDK Core` as the provider abstraction layer
- `Anthropic` first via `@ai-sdk/anthropic`
- future providers via `@ai-sdk/openai` and `@ai-sdk/google`
- optional `AI SDK UI` or custom UI transport for streaming polish

## 7.2 High-Level Shape

```text
Chat UI / structured controls
          |
          v
App-owned conversation engine
          |
          v
Canonical preferences draft + validation
          |
          v
Task-oriented LLM service layer
          |
          v
Provider adapters (Anthropic first, OpenAI/Google later)
```

## 7.3 Core Principle

The app should not ask the model "what should we ask next?"

Instead, the app should ask:

- "parse this user input into partial preferences"
- "summarize the current draft"
- "propose a clarification for this ambiguous answer"
- "map this role title to an existing family or propose a new one"

That is a much safer and more maintainable contract.

---

## 8. Recommended LLM Interaction Style

## 8.1 Prefer Structured Output Over Tool-Driven Agent Loops

For this chatbot, structured extraction is usually a better fit than open-ended tool calling.

Why:

- The model is not deciding which tool to use next
- The app already knows which field or step it is collecting
- The most common need is "convert free text into typed data"
- Structured output is easier to validate and test than model-driven tool loops

Tool calling should be reserved for cases where the model truly needs an external action. It should not be the default conversation mechanism.

## 8.2 Streaming Should Be Selective

Streaming is useful for:

- assistant explanations
- clarifications
- summaries

Streaming is not required for:

- validation results
- field updates
- deterministic next-step decisions

This means the initial implementation does not need to make streaming the center of the architecture.

---

## 9. Provider Strategy

## 9.1 Anthropic First

The first provider should be `Anthropic` because it already aligns with the current product direction and BYOK assumptions.

Recommended initial packages:

- `ai`
- `@ai-sdk/anthropic`
- `zod`

## 9.2 Future Multi-Provider Support

The provider layer should be designed so the rest of the app does not care whether a task is handled by `Anthropic`, `OpenAI`, or `Google`.

Recommended future packages:

- `@ai-sdk/openai`
- `@ai-sdk/google`

The app should route by task, not by UI surface.

Example:

- `extractPreferencesFromFreeText` -> provider selected by config
- `summarizePreferenceDraft` -> provider selected by config
- `proposeRoleFamilyExpansion` -> provider selected by config

## 9.3 Capability Rule

Design around the common denominator first:

- structured object generation
- short text generation
- optional streaming

Do not make the core architecture depend on vendor-specific features unless they are wrapped inside an adapter.

## 9.4 Escape Hatch Rule

The default path should use `AI SDK Core`.

If a specific provider feature becomes important enough, allow that single adapter to bypass the generic layer internally without changing the app-facing contract.

This preserves portability without blocking provider-specific optimization.

---

## 10. Recommended App-Facing Abstraction

The app should not work with a generic "chat model" directly.

It should depend on a task-oriented service contract.

Example:

```ts
type LlmProviderId = "anthropic" | "openai" | "google";

interface PreferenceCollectionLlm {
  extractPartialPreferences(input: {
    userText: string;
    currentStep: string;
    currentDraft: unknown;
  }): Promise<unknown>;

  summarizeDraft(input: {
    currentDraft: unknown;
  }): Promise<string>;

  proposeClarification(input: {
    userText: string;
    currentStep: string;
    currentDraft: unknown;
  }): Promise<string>;

  proposeRoleFamilyExpansion(input: {
    targetRole: string;
    existingFamilies: string[];
  }): Promise<unknown>;
}
```

This keeps provider details and model APIs out of the application workflow.

---

## 11. Canonical State Design

The chatbot should persist at least two different artifacts:

### 11.1 Canonical state

A structured preference draft:

- current collected values
- current step
- missing required fields
- validation status
- pending confirmations

This is the real source of truth.

### 11.2 Optional transcript

A message history for UX, review, and analytics.

Important rule:

The transcript may help reconstruct context, but it must not be the authoritative state for required preferences.

---

## 12. Recommended Stack For This Repository

## 12.1 MVP Stack

- `ai`
- `@ai-sdk/anthropic`
- `zod`
- `react-hook-form`
- custom app-owned conversation engine

## 12.2 Add When Needed

- `@ai-sdk/openai`
- `@ai-sdk/google`
- `xstate` if branching complexity grows
- `@ai-sdk/react` or `assistant-ui` if the chat UI needs richer streaming patterns

## 12.3 Why This Stack Fits The Repository

- The repo currently has no LLM/chat dependency lock-in yet
- The app is already `Next.js` and TypeScript-first
- The business logic is structured and validation-heavy
- The product already anticipates multiple model-powered features, not just one chat surface
- Provider portability matters from the start

---

## 13. Final Recommendation

### Best overall direction

Use a hybrid architecture:

- deterministic app-managed dialogue
- structured preference draft as source of truth
- limited LLM responsibilities
- `Vercel AI SDK Core` as the provider abstraction layer
- `Anthropic` as the first provider
- clean path to `OpenAI` and `Google`

### Best interpretation of the original options

- `Structured flow` is the architectural foundation
- `Vercel AI SDK` is the best provider abstraction and optional streaming layer
- Direct `Anthropic SDK` should be kept as an internal escape hatch, not the primary app contract

### Not recommended as the core design

- model-controlled dialogue
- generic agent frameworks for the initial onboarding chatbot
- letting transcript state replace canonical structured state
- building the provider layer directly around one vendor's SDK

### Practical conclusion

The right answer for this application is not "AI chat vs form".

The right answer is:

- a structured onboarding engine that looks conversational
- with LLM assistance only where natural language actually adds value
- and with a provider abstraction that starts with `Anthropic` but does not trap the product there

---

## 14. References

- [Vercel AI SDK Chatbot](https://sdk.vercel.ai/docs/ai-sdk-ui/chatbot)
- [Vercel AI SDK Structured Data](https://sdk.vercel.ai/docs/ai-sdk-core/generating-structured-data)
- [Vercel AI SDK Provider Registry](https://sdk.vercel.ai/docs/reference/ai-sdk-core/provider-registry)
- [Anthropic TypeScript SDK](https://platform.claude.com/docs/en/api/sdks/typescript)
- [Anthropic Structured Outputs](https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs)
- [AI SDK Anthropic Provider](https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic)
- [AI SDK OpenAI Provider](https://sdk.vercel.ai/providers/ai-sdk-providers/openai)
- [AI SDK Google Provider](https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai)
