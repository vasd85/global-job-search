# Product Manifesto

## Purpose

This document defines what the product is, what it does, and what trade-offs are pre-decided. It is the canonical reference for any agent working on this product at any level: product strategy, feature design, architecture, implementation, testing, content. All other documents must be consistent with this one. When a proposal contradicts this document, this document wins.

## North Star

The user accepts a job offer for a role that matches the preferences captured in their profile. This is the product's ultimate goal and the overall sanity check for the system. It is not a metric agents optimize on in individual tasks.

## Responsibility of the System

The system does not control whether the user receives or accepts an offer. It influences the outcome indirectly. The system is measured by the indirect levers it can control. A metric is legitimate only if it satisfies two conditions simultaneously: it lies within the system's zone of control, and it is a reasonable proxy for the north star. Volume metrics (vacancies shown, applications sent, users in the system) do not satisfy the second condition and are not used as KPIs.

No single metric on an indirect lever is sufficient. Lever metrics are periodically validated against the north star. When they diverge, the north star wins.

## Principles

1. The profile is the compass, not the destination. The user's goal is a job offer, not a polished profile. The profile is the input to the system and the structure that shapes everything downstream.

2. The profile is private. It exists for the user only. The system does not expose the profile publicly or make it browsable by recruiters. There is no "open to work" signal.

3. The profile is complete and honest. The user records the full picture inside the system, including gaps, failed projects, and unfinished work. This is possible because the profile is private. The completeness is what makes the system's output (role-specific projections) accurate and grounded in real facts rather than generic AI-generated content.

4. Roles are selected for the profile, not the profile for roles. The user does not bend themselves to vacancies. The system filters the world of vacancies through the user's profile, not the other way around.

5. Repackaging, not rewriting. For a given role, the system extracts and emphasizes the parts of a stable profile that are relevant. The user does not maintain multiple resumes or rewrite who they are per vacancy.

6. Evidence is part of the profile. The profile substantiates, it does not only describe. Concrete experience with numbers, links to work, portfolio artifacts, and project references are first-class profile content.

7. Automation removes routine, but humans decide. The system finds matched vacancies, gathers context about company and role, and drafts role-specific applications (CV tailored to the role, cover letter, answers to application questions). The user reads, evaluates, and submits. The system does not submit on behalf of the user.

8. The product is iterative. Search, market feedback, and profile refinement form a loop, not a sequence. The profile is expected to evolve as the user learns from results.

9. Best matches means few and considered, not many and automated. The system optimizes for selectivity, not throughput.

10. The user is responsible for outcomes. The system is a tool. It explains how to use itself effectively and provides relevant context; it does not assume responsibility for the user's choices.

11. Global by default. The system searches roles worldwide. The user can narrow the scope to specific markets, but unrestricted global search is the default behavior.

12. The product is for users who approach job search thoughtfully and selectively. It is not optimized for mass-blast use cases. Users with urgent needs can broaden their filters within the same framework, but the framework itself does not change to accommodate volume-driven workflows.

## Anti-patterns

The product is NOT:

- LinkedIn. We do not host public, browsable profiles. We do not provide an inbound channel where recruiters search and contact users.

- LazyApply, Sonara, or any other mass-application tool. We do not submit applications automatically. We do not optimize for application volume.

- A careers coach or self-discovery platform. We do not help users figure out their identity or calling. We assume the user has a working sense of what they offer and want, and we help them sharpen, evidence, and apply it.

- A universal job aggregator. We do not show every available vacancy. We surface a narrow, curated set of well-matched roles.

- A recruiting tool for employers. The product serves the candidate side. Employers are not customers and the product does not optimize for their needs.

- A blank-slate resume generator. The system's outputs are projections of a stable, honest internal profile, not freshly invented content per role.

## Scope

Current scope: from profile to application. Building and refining the profile, finding matched vacancies, gathering context about the company and role, preparing role-specific applications, supporting the user up to the point of submission.

Out of current scope but identified as natural future extensions: interview preparation, self-presentation rehearsal, offer negotiation, comparing multiple offers, networking, post-hire support.

Because the system holds detailed context about the user, the company, and the role, it can serve as a contextual interlocutor for any topic where that combined context is relevant. This is a capability that emerges from the architecture, not a separate feature category.

## Conflict Resolution

When principles conflict in a specific decision, the following priority applies:

1. The north star takes priority over any indirect metric.
2. User decision takes priority over automation. When a design would shift judgment from the user to the system, the user's role is preserved.
3. Selectivity takes priority over throughput. When a design would increase volume at the expense of match quality, match quality wins.
4. Profile honesty takes priority over profile presentability. The internal profile reflects reality including gaps and fails; presentability is a property of the projection, not of the source.
5. Long-term product integrity takes priority over short-term compliance with user requests. If a user requests behavior that violates a principle (for example, "submit one hundred applications per day"), the system explains why it does not do that, rather than complying.

## Glossary

- Profile: the structured, private, internal representation of the user's experience, skills, preferences, evidence, and constraints. Editable by the user. Visible only to the user. Used by the system to find roles and to generate role-specific projections.

- Offer (the user's offer): the synthesized statement of what the user can and wants to do, derived from the profile. The user's pitch to the market. Distinct from a job offer, which is the employer's offer of employment and is referred to explicitly as "job offer" throughout this document.

- Projection: the role-specific external artifact derived from the profile for a particular vacancy. Typically includes a role-tailored CV, cover letter, and answers to application questions. The profile is stable; projections vary per role.

- Match: a vacancy that the system has identified as a fit for the user's profile. Match quality is the degree of alignment between profile and role.

- North star: the user's accepted job offer for a role that matches their profile preferences. The product's ultimate goal and overall sanity check; not a per-task optimization target.

- Indirect lever: a system-controlled variable that is a reasonable proxy for the north star. The legitimate domain for system-level metrics.

- Iteration: the cycle of searching, applying, receiving market feedback, and refining the profile. The product's primary operational loop.
