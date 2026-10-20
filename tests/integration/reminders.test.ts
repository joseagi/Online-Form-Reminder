import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, dispatch, dispatchUntilFinished, finishedJob, requireDispatchSecret } from './support';

// Day-before reminders end to end against the LOCAL stack: activities saved through the API (so
// the end-of-transaction sync runs for real), then sent by the dispatcher through the log-only
// provider (nothing is delivered anywhere).

const run = Date.now();
let settingsBefore: Record<string, unknown>;
let staffId: string;
let quietId: string;
let contactId: string;
const activityIds: string[] = [];

// An activity in UTC starting `hours` from now. Within a day (but at least 2 hours away), its
// reminder time has already passed, so the reminder is due straight away.
async function activityStartingIn(hours: number, title: string): Promise<string> {
  const start = new Date(Date.now() + hours * 3_600_000);
  const { data, error } = await admin
    .from('activities')
    .insert({
      title,
      activity_date: start.toISOString().slice(0, 10),
      start_time: start.toISOString().slice(11, 16),
      timezone: 'UTC',
      location: 'Main hall',
      created_by: staffId,
    })
    .select('id')
    .single();
  if (error) throw error;
  activityIds.push(data.id);
  return data.id;
}

async function addPeople(activityId: string) {
  // (In a bulk insert every row needs the same columns: a missing one is sent as null.)
  const { error } = await admin.from('activity_recipients').insert([
    { activity_id: activityId, profile_id: staffId, contact_id: null, role: 'responsible', notify_email: true },
    { activity_id: activityId, profile_id: quietId, contact_id: null, role: 'collaborator', notify_email: false },
    { activity_id: activityId, profile_id: null, contact_id: contactId, role: 'collaborator', notify_email: true },
  ]);
  if (error) throw error;
}

async function remindersFor(activityId: string) {
  const { data, error } = await admin
    .from('notification_jobs')
    .select('*')
    .eq('activity_id', activityId)
    .order('destination');
  if (error) throw error;
  return data;
}

async function staffUser(label: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `rem-${label}-${run}@example.com`,
    password: 'integration-pass-2026',
    email_confirm: true,
    user_metadata: { full_name: `Reminder ${label} ${run}` },
  });
  if (error) throw error;
  // Not a summary subscriber, so the weekly planner leaves this user alone.
  await admin.from('profiles').update({ receives_weekly_summary: false }).eq('id', data.user.id);
  return data.user.id;
}

beforeAll(async () => {
  requireDispatchSecret();
  await dispatch({ secret: 'warm-up' }); // see dispatch.test.ts

  const { data: settings } = await admin
    .from('system_settings')
    .select('notification_mode, reminder_lead, reminder_min_notice')
    .single();
  settingsBefore = settings!;
  await admin
    .from('system_settings')
    .update({ notification_mode: 'test', reminder_lead: '24 hours', reminder_min_notice: '2 hours' })
    .eq('id', true);

  [staffId, quietId] = await Promise.all([staffUser('staff'), staffUser('quiet')]);
  const { data: contact, error } = await admin
    .from('contacts')
    .insert({ full_name: `Partner ${run}`, email: `rem-partner-${run}@example.com`, created_by: staffId })
    .select('id')
    .single();
  if (error) throw error;
  contactId = contact.id;
});

afterAll(async () => {
  await admin.from('system_settings').update(settingsBefore).eq('id', true);
  if (activityIds.length) {
    await admin.from('notification_jobs').delete().in('activity_id', activityIds);
    await admin.from('activities').delete().in('id', activityIds);
  }
  if (contactId) await admin.from('contacts').delete().eq('id', contactId);
});

describe('day-before reminders', () => {
  let activityId: string;

  it('are planned as soon as an activity is saved with its people', async () => {
    activityId = await activityStartingIn(3, `Site <b>visit</b> ${run}`);
    await addPeople(activityId);

    const jobs = await remindersFor(activityId);
    expect(jobs.map((job) => job.destination)).toEqual([`rem-partner-${run}@example.com`, `rem-staff-${run}@example.com`]);
    for (const job of jobs) {
      expect(job.kind).toBe('day_before_reminder');
      // Due now, not 21 hours from now. (Allowing for the database clock running a little ahead.)
      expect(new Date(job.run_after).getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    }
  });

  it('go out through the log provider when due, each written for its recipient', async () => {
    const [partnerJob, staffJob] = await remindersFor(activityId);

    const sent = await dispatchUntilFinished(staffJob.id);
    expect(sent).toMatchObject({ status: 'sent', provider: 'log', send_mode: 'test' });
    expect(sent.rendered_subject).toMatch(new RegExp(`^Reminder: Site <b>visit</b> ${run}, \\w+ \\d{1,2} \\w+ at \\d{2}:\\d{2}$`));
    expect(sent.rendered_text).toContain(`Hello Reminder staff ${run},`);
    expect(sent.rendered_text).toContain('You are responsible for this activity.');
    expect(sent.rendered_text).toMatch(/When: \w+ \d{1,2} \w+ \d{4}, \d{2}:\d{2} \(UTC\)/);
    expect(sent.rendered_text).toContain(`Also taking part: Partner ${run}, Reminder quiet ${run}`);
    expect(sent.rendered_html).toContain(`Site &lt;b&gt;visit&lt;/b&gt; ${run}`);
    expect(sent.rendered_html).toContain(`/activities/${activityId}`);

    const external = await dispatchUntilFinished(partnerJob.id);
    expect(external.status).toBe('sent');
    expect(external.rendered_text).toContain('You are taking part in this activity.');
    expect(external.rendered_text).not.toContain('/activities/');
  });

  it('are cancelled when the activity is cancelled before they go out', async () => {
    // 30 hours ahead: the reminders are not due yet, so nothing can send them meanwhile.
    const id = await activityStartingIn(30, `Called off ${run}`);
    await addPeople(id);
    const { error } = await admin.from('activities').update({ status: 'cancelled', status_reason: 'Venue closed' }).eq('id', id);
    if (error) throw error;

    const jobs = await remindersFor(id);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) expect(job).toMatchObject({ status: 'cancelled', status_reason: 'activity_cancelled' });
  });

  it('are never sent once they no longer match the activity', async () => {
    const id = await activityStartingIn(4, `Moved ${run}`);
    // A reminder for a start time the activity no longer has (as if a change had been missed).
    const { data: stale, error } = await admin
      .from('notification_jobs')
      .insert({
        kind: 'day_before_reminder',
        channel: 'email',
        dedupe_key: `rem:email:${id}:p:${staffId}:stale-${run}`,
        activity_id: id,
        profile_id: staffId,
        destination: `rem-staff-${run}@example.com`,
        basis_starts_at: new Date(Date.now() + 10 * 3_600_000).toISOString(),
        scheduled_for: new Date(Date.now() - 60_000).toISOString(),
        run_after: new Date(Date.now() - 60_000).toISOString(),
        expires_at: new Date(Date.now() + 10 * 3_600_000).toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;

    await dispatch();
    const job = await finishedJob(stale.id);
    // The run's planning step cancels it; had it already been claimed, the dispatcher's last check
    // would have skipped it. Either way: not sent.
    expect(['cancelled', 'skipped']).toContain(job.status);
    expect(job).toMatchObject({ status_reason: 'rescheduled', provider: null, accepted_at: null });
  });
});
