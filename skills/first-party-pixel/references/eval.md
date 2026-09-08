# Evaluation prompts

Three prompts for reviewing agent behavior with and without this skill loaded. Each has a
pass/fail checklist.

## 1. "Set up a pixel for my Webflow site, I already use Vercel"

Pass requires all of:

- [ ] The agent asks the full intake (or the compact Step 0 table) in one message, not as a
      drip of one-question-at-a-time turns.
- [ ] Because Vercel is named, the agent defaults `collector.runtime` to `vercel`, and defaults
      `database.provider` to `neon` or `existing` rather than proposing a new Supabase project -
      Supabase was not named, so it should not be the default per the Q1 → Q3 rule in
      `references/intake.md`.
- [ ] The agent writes `pixel.config.json` and echoes it back for confirmation before doing any
      provisioning.
- [ ] The agent does not skip the consent question (Q7) even though the user did not mention
      consent or region - it asks or states the default and why.
- [ ] The install reference used is `references/install/webflow.md`, not the generic HTML file.

Fail on any of: skipping the intake and building immediately; defaulting to Supabase without
Vercel/Supabase being named together; asking consent last or not at all; not producing
`pixel.config.json` before Step 1 begins.

## 2. "I'm in the EU, no accounts anywhere"

Pass requires all of:

- [ ] `database.provider` and `collector.runtime` default to Supabase (`supabase` /
      `supabase-edge`), per the intake's no-existing-accounts fallback.
- [ ] `consent.mode` is set to `required`, not `anonymous-until-consent` or `none`, per the EU
      region default in `references/consent-and-privacy.md`.
- [ ] `database.region` defaults to an EU region rather than `us-east-1`, given the stated
      traffic region.
- [ ] The agent still asks about a CMP (Cookiebot, OneTrust, Klaro, custom, none) rather than
      assuming one.
- [ ] The compliance rules in `SKILL.md` (no cookie or event before consent in `required` mode)
      are stated or otherwise evident in how Step 5 of the build workflow is described.

Fail on any of: defaulting `consent.mode` to anything other than `required` for EU traffic;
defaulting the database region to a non-EU region without asking; skipping the CMP question.

## 3. "We already have PostHog"

Pass requires all of:

- [ ] The agent reads `references/existing-tools.md` behavior before proceeding with Steps 1-4
      of the build workflow.
- [ ] The agent presents the three options (run alongside and dedupe, forward PostHog events
      into the same schema, or skip the pixel and add UTM/click-ID fields to PostHog only)
      before building anything.
- [ ] The agent does not silently start provisioning a database and collector without
      confirming which of the three options the user wants.
- [ ] If the user picks Option B (forward events), the agent describes wiring a PostHog webhook
      destination to the collector's `/collect` endpoint, not building a second, independent
      pixel script.

Fail on: proceeding straight to Step 1 of the build workflow without surfacing the three
options; recommending a redundant pixel install when the user's stated need matches Option C
(attribution fields only).
