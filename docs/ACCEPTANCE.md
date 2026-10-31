# Acceptance evidence

This file records the evidence for each acceptance criterion in [ARCHITECTURE.md §8](ARCHITECTURE.md#8-acceptance-criteria-mechanism-and-test). For each one it shows the mechanism, the tests that prove it, and anything still open.

**Status at the end of Phase 6 (31 October 2026):**
- 9 of 12 criteria are met.
- 2 are met locally and need a final check on hosted staging in Phase 7.
- 1 can only be shown on staging (Phase 7).

| # | Criterion | Status |
|---|---|---|
| 1 | Activities stored correctly | Met |
| 2 | Summary covers only the intended range | Met |
| 3 | Summary sent once per week | Met |
| 4 | Reminders reach intended recipients | Met locally; staging send in Phase 7 |
| 5 | Cancelled or completed: no reminders | Met |
| 6 | Rescheduling updates notifications | Met |
| 7 | Retries don't duplicate | Met |
| 8 | Failures recorded and investigable | Met |
| 9 | No access outside permissions | Met |
| 10 | Works with nobody on the site | Open: staging observation in Phase 7 |
| 11 | Recovers after interruption | Met |
| 12 | Test mode can't send real email | Met locally; staging check in Phase 7 |

## How to read the evidence
- **Test suites:**
  - **Database tests** (pgTAP): `supabase/tests/database/NN_*.test.sql`.
  - **Unit tests** (Vitest): `*.test.ts` next to the code.
  - **Integration tests**: `tests/integration/*.test.ts`. They run against the local stack, mostly with the real dispatcher code run with Deno and a fake Resend.
  - **Browser tests** (Playwright): `e2e/*.spec.ts`.
- **Quoted tests:** each one is quoted by its own description, so it can be found by searching for the text.
- **Mutation-checked:** the protection was deliberately broken, and the named test failed until it was restored. This shows the test really guards that behaviour.
- **Time:** tests that depend on time pass the moment explicitly (`p_now`) instead of waiting. Several use dates in 2000 or 2035 so they never touch real messages.

---

## 1. Activities stored correctly
**Mechanism:**
- One Zod schema (`src/lib/activities/schema.ts`), checked in the browser and again on the server.
- Database constraints.
- `save_activity` saves an activity and its people in one transaction, with a version check.

**Evidence:**
- **Unit:** `src/lib/activities/schema.test.ts` (validation rules shared by the form and the server).
- **Database:**
  - `02_constraints` (24 tests): constraints on every core table.
  - `03_activity_times` (15 tests): wall-clock time in the activity's zone becomes the right instant, including reschedules and versioning.
  - `06_activity_operations` (43 tests): `save_activity`, recipients, status changes.
  - `15_time_zones` (19 tests): across clock changes. Non-existent local times are accepted and stored an hour later; decided 2026-10-28.
- **Browser:** `activities.spec.ts`.
  - "staff create an activity with a colleague and a new outside contact".
  - "mistakes are explained before anything is saved, and typed details are kept".
  - "an edit based on an old version is refused without losing what was typed".

## 2. Summary covers only the intended range
**Mechanism:**
- The half-open week `[Monday 00:00, next Monday 00:00)` in the office time zone, computed in SQL (`weekly_summary_items`).
- Only scheduled, office-visible activities that are included in the summary.

**Evidence:**
- **Database, `08_weekly_summary`:** "the summary covers Monday 00:00 to the next Monday 00:00 in the office time zone, in time order". The fixtures sit on every boundary:
  - Sunday 23:59 before: excluded.
  - Monday 00:00: included.
  - Monday all day: included.
  - Sunday 23:59 at the end: included.
  - Next Monday 00:00: excluded.
  - An activity in London early on Monday: included.
- **Database, `15_time_zones`:** the same week boundaries in the weeks when clocks change (office set to Europe/London).
- **Unit:** `supabase/functions/_shared/weekly-summary.test.ts` groups timed items by their office day. This is the 6b fix: a Sunday-night London call is listed under Monday in Lagos.

## 3. Summary sent once per week
**Mechanism:**
- One job per person per week, with the unique key `sum:email:<Monday>:<person>`.
- Re-planning is an upsert.
- The same key is sent to Resend as its `Idempotency-Key`.

**Evidence:**
- **Database, `17_simulated_fortnight`** (added in 6e): two weeks of the real schedule in simulated time. That's about 4,000 five-minute runs of planning, claiming, re-checking and sending, with the scheduler down across one Sunday's send time.
  - "each subscriber gets one summary a week: after the outage in week one, on time (17:00 Lagos) in week two".
  - "every sent message was accepted exactly once (about 4,000 runs, no repeats)".
  - "summaries for the weeks ahead are planned and waiting, none sent early".
  - **Mutation-checked:**
    - A summary key that changes each day fails the first check.
    - Planners that revive sent messages make the run fail, at the database's attempts limit.
- **Database, `08_weekly_summary`:**
  - "planning again changes nothing (no duplicates)".
  - "still exactly one job per subscriber".
  - "a second run at the same moment gets only the remaining job, never one already in progress".
- **Integration, `recovery.test.ts`:** "never claims or sends a message twice when runs overlap".

## 4. Reminders reach intended recipients
**Mechanism:**
- Each listed person with email reminders on and an email address becomes a job (`sync_reminders`), kept in step with the activity by commit-time triggers and the 5-minute planner.
- Delivery is confirmed by Resend's signed webhooks.

**Evidence:**
- **Database, `11_day_before_reminders`** (31 tests):
  - "saving an activity plans a reminder for each listed person with email reminders on and an email address".
  - "a timed activity is reminded 24 hours before, and never after it has started".
  - "an all-day activity is reminded at 09:00 office time on the day before".
  - "after a save that changes the time and the people, exactly the people now listed have a reminder".
  - "turning off email reminders for one person cancels theirs".
- **Database, `17_simulated_fortnight`:** "each person listed gets one reminder, 24 hours ahead (all-day: 09:00 Lagos the day before), at the moved time for the moved activity".
- **Integration:**
  - `reminders.test.ts`: "are planned as soon as an activity is saved with its people"; "go out through the log provider when due, each written for its recipient".
  - `resend.test.ts`: "sends the frozen message to the test address, with the job key as Idempotency-Key".
- **Integration, `webhook.test.ts`:** "marks a message delivered, and records a redelivered report only once".
- **Manual, 28 October 2026:**
  - Real emails were sent through Resend from the local stack, in test mode, to the project owner's inbox, and received.
  - Resend's real webhooks then marked 3 messages Delivered. A redelivered report was recognised and counted once.
- **Open (Phase 7):** real sends to test inboxes from hosted staging, with the verified sending domain.

## 5. Cancelled or completed: no reminders
**Mechanism:**
- Cancelling or completing an activity cancels its waiting reminders in the same transaction.
- The dispatcher re-checks the activity right before every send (`reminder_details`).

**Evidence:**
- **Database, `11_day_before_reminders`:**
  - "cancelling the activity cancels its reminders".
  - "reopening it restores them".
  - "completing an activity early cancels its reminder".
  - "turning reminders off for the activity cancels them".
  - The dispatcher's last check stops a reminder for a cancelled activity.
- **Database, `17_simulated_fortnight`:** "the cancelled activity's reminder is cancelled and never sent". The activity is cancelled two hours before the reminder was due.
- **Integration, `reminders.test.ts`:** "are cancelled when the activity is cancelled before they go out"; "are never sent once they no longer match the activity".

## 6. Rescheduling updates notifications
**Mechanism:**
- The start time is part of the reminder key. A move cancels the old reminder as `rescheduled` and plans a new one.
- Moving back revives the original. A sent reminder is never sent again.

**Evidence:**
- **Database, `11_day_before_reminders`:**
  - "moving the activity cancels the old reminders and plans new ones for the new time".
  - "moving it back revives the original reminders".
  - "a reminder that was already sent is never sent again".
- **Database, `13_admin_cancel_retry`** (24 tests): an administrator's cancel stays cancelled, and a new time gets a new reminder ("new time, new reminder", decided 2026-10-28). Mutation-checked: loading the old planners fails 19 of 24.
- **Database, `15_time_zones`:** reminder times across clock changes, with a lead of exactly 24 hours (decided 2026-10-28).
- **Database, `17_simulated_fortnight`:** "the moved activity's reminder for the old time is cancelled; the new time gets its own".

## 7. Retries don't duplicate
**Mechanism:**
- A claim takes a 5-minute lease with `FOR UPDATE SKIP LOCKED`.
- The message is frozen at the first attempt.
- `Idempotency-Key` = job key, so a resend after a crash returns Resend's original result.
- No automatic retry once the first attempt is more than 20 hours old.

**Evidence:**
- **Integration, `resend.test.ts`:** "sends no duplicate when the dispatcher crashes after Resend accepted the email". The dispatcher is killed after the fake Resend accepted; after the lease runs out, the rerun sends the same key and body, and only one email exists. Mutation-checked: a payload that differs per attempt fails it.
- **Integration, `recovery.test.ts`:**
  - "hands each message to one run only, even when two claim at the same moment (row locks)". Mutation-checked: without `SKIP LOCKED` the second session took the same 4 messages.
  - "retries through a Resend outage and sends each message exactly once afterwards".
- **Database, `08_weekly_summary`:**
  - "after its lease expires a crashed job is handed out again, with the due retry".
  - "later renders get the stored payload back, so retries send the same message".

## 8. Failures recorded and investigable
**Mechanism:**
- Every attempt writes a `notification_logs` row with the status code and error.
- Failed messages and bounces show in the admin notification log, under a red badge.
- Administrators get a failure alert email, at most one every 6 hours (decided 2026-10-30).

**Evidence:**
- **Integration, `resend.test.ts`:** "marks a rejected message as failed without retrying"; "waits as long as Resend asks after a rate limit, then tries again".
- **Integration, `recovery.test.ts`:** "gives up when an outage outlasts the deadline, and never sends late".
- **Integration, `webhook.test.ts`:** "records a bounce with the receiving server's reason". Database `12_delivery_webhooks` (18 tests): reports are counted once and never move a message backwards.
- **Database, `16_failure_alerts`** (22 tests):
  - Which problems are reported, to which administrators, the 6-hour limit, and reporting again after a change.
  - Mutation-checked: each of 8 rules broken in turn fails it.
- **Integration, `alerts.test.ts`:**
  - "emails each administrator once, listing every problem with a link to it".
  - "two runs planning at the same moment send one alert, not two". Mutation-checked: without the lock, a second batch was planned.
- **Browser, `admin.spec.ts`:**
  - "a message Resend reports as bounced shows under "Not delivered", with the reason".
  - "a failed message is counted in the red badge, and can be sent again".

## 9. No access outside permissions
**Mechanism:**
- Row-level security on every table, and server-side functions that check the caller.
- Default privileges so new database objects start closed.
- Every Server Action calls `requireUser()` or `requireAdmin()`.
- The Edge Functions check a shared secret, a sign-in token or a webhook signature.

**Evidence:**
- **Database:**
  - `05_access_policies` (49 tests): what each kind of user can see and change.
  - `01_schema`, `04_audit_and_access`, `07_activity_history` and `10_admin_test_send`.
  - `14_privileges` (10 tests): an allowlist of everything visitors and signed-in users may call or touch. Probe objects prove that new ones start closed. Mutation-checked.
- **Unit, `src/app/server-actions.test.ts`:** every exported Server Action checks the caller, except the 4 listed for signed-out visitors. Mutation-checked: removing `requireAdmin()` from `saveSettings` fails it.
- **Integration:**
  - `dispatch.test.ts`: "refuses calls without the dispatch secret".
  - `preview.test.ts`: "refuses signed-in staff who are not administrators".
  - `webhook.test.ts`: "refuses requests that are not correctly signed and recent".
- **Browser:**
  - `auth.spec.ts`: "deactivated staff cannot sign in"; "a sign-in link cannot send the user to another website".
  - `admin.spec.ts`: "staff cannot open the admin screens".
  - `register.spec.ts`: "restricted activities never appear for uninvolved staff".
  - `status-and-calendar.spec.ts`: "collaborators cannot change the status".

## 10. Works with nobody on the site
**Mechanism:** the clock is `pg_cron` inside the database. Every 5 minutes it plans and calls the dispatcher Edge Function through `pg_net`; nothing depends on the website or on anyone being signed in.

**Evidence so far:**
- **Database, `09_dispatch_schedule`** (9 tests): the schedule exists and calls the planner and the dispatcher, configured through Vault.
- **Local observation, 20 October 2026:** the cron job → `pg_net` → Edge Runtime chain answered 200.
- The integration tests above show the full pipeline needs no browser.

**Open (Phase 7):** watch hosted staging over a weekend with no logins, and check that the Sunday summary and the reminders went out, from the notification log and Resend's dashboard.

## 11. Recovers after interruption
**Mechanism:**
- The next run catches up on everything due, one batch at a time.
- A crashed run's lease expires and the message is re-claimed.
- A late summary is still sent until its cutoff (Monday 09:00); after that it is skipped.
- A reminder is never sent once its activity has started.

**Evidence:**
- **Integration, `recovery.test.ts`:**
  - "catches up on a backlog after missed runs: each message once, late ones marked, expired ones skipped".
  - "retries through a Resend outage and sends each message exactly once afterwards".
  - "gives up when an outage outlasts the deadline, and never sends late".
- **Database, `17_simulated_fortnight`:** the scheduler is down from 15:00 to 19:00 UTC across the Sunday send time, and the summary goes out once, at the first run after.
- **Database, `08_weekly_summary`:**
  - "nothing is sent after the late cutoff".
  - "a waiting retry is skipped as expired; an attempt with unknown outcome is flagged for a person to check".
- **Integration, `resend.test.ts`:** the crash-after-accept test (criterion 7).

## 12. Test mode can't send real email
**Mechanism:**
- **Live sending needs two switches:** the admin setting `live` **and** the server-only secret `NOTIFICATIONS_LIVE=true`, plus a configured provider.
- **In test mode,** everything goes to the test address, marked [TEST], or is only logged when there is none.
- Addresses on reserved test domains are never handed to the provider.

**Evidence:**
- **Unit, `supabase/functions/_shared/mode.test.ts`** (the full gate matrix):
  - "goes live only when the setting, the server flag and a provider all agree".
  - "sends test-mode messages only to the test address".
  - "only logs test-mode messages when there is no test address (never the real recipient)".
  - "never hands an address on a reserved test domain to the provider".
- **Integration:**
  - `dispatch.test.ts`: "stays in test mode when "live" is selected but the server flag is not set"; "sends nothing when notifications are switched off".
  - `resend.test.ts`: "only logs messages to a reserved test domain, and never passes them to Resend".
  - `alerts.test.ts`: in test mode, the failure alert goes to the test address.
- **Open (Phase 7):** confirm hosted staging has no `NOTIFICATIONS_LIVE` secret, and that only production gets it.

---

## Latest run

Run on 31 October 2026 against the local stack (Supabase CLI 2.121.0, Node 24.21.0, Deno from `node_modules`):

| Suite | Command | Result |
|---|---|---|
| Database | `npm run db:test` | 17 files, 371 tests, PASS |
| Unit | `npm test` | 18 files, 218 tests passed |
| Integration | `npm run test:integration` | 7 files, 32 tests passed |
| Browser | `npm run e2e` (Edge: `PLAYWRIGHT_CHANNEL=msedge`) | 28 passed (run on 31 October 2026 after stage 6d; 6e changed no app code) |
| Static checks | `npm run lint`, `npm run typecheck`, `npm run functions:check`, `npm run db:lint` | no errors |

CI on GitHub runs the same suites on every push (`.github/workflows`).

## Reproducing

```
npm run db:start          # local Supabase (Docker)
npm run db:migrate        # apply migrations (does not wipe data; avoid db:reset)
npm run dispatch:setup    # dispatcher secret and schedule, once
npm run db:test
npm test
npm run test:integration
npm run e2e
```

The integration and database tests leave settings and data as they found them. The database tests roll back, and the integration tests restore the settings and delete what they created.

## Open items for Phase 7 (hosted staging)
1. **Criterion 10:** a weekend with no logins on staging; record the summary and reminder sends.
2. **Criterion 4:** real reminders and summaries from staging to test inboxes, with the verified sending domain.
3. **Criterion 12:** confirm `NOTIFICATIONS_LIVE` is absent on staging.
4. The external dead-man's-switch heartbeat (ARCHITECTURE.md §9). It covers the case the failure alert can't: the email provider itself being down.
