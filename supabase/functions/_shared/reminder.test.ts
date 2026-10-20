import { describe, expect, it } from 'vitest';
import { renderReminder, type ReminderDetails } from './reminder.ts';

const base = { officeName: 'Lagos Office', officeTimezone: 'Africa/Lagos', appUrl: 'https://office.example' };

function details(overrides: Partial<ReminderDetails> = {}): ReminderDetails {
  return {
    activity_id: '00000000-0000-4000-8000-0000000000a1',
    title: 'Board meeting',
    description: null,
    activity_date: '2035-03-06',
    start_time: '10:00:00',
    end_time: '11:30:00',
    timezone: 'Africa/Lagos',
    location: 'Board room',
    meeting_url: null,
    contact_name: null,
    contact_phone: null,
    contact_email: null,
    preparation_notes: null,
    recipient_name: 'Bayo Staff',
    recipient_role: 'collaborator',
    recipient_is_staff: true,
    responsible_name: 'Ada Admin',
    others: ['Chika Staff'],
    ...overrides,
  };
}

describe('renderReminder', () => {
  const message = renderReminder({ ...base, details: details() });

  it('names the activity, its day and its start time in the subject', () => {
    expect(message.subject).toBe('Reminder: Board meeting, Tuesday 6 March at 10:00');
  });

  it('greets the person and says what is happening, when and where', () => {
    expect(message.text).toContain('Hello Bayo Staff,');
    expect(message.text).toContain('When: Tuesday 6 March 2035, 10:00–11:30');
    expect(message.text).toContain('Where: Board room');
    expect(message.html).toContain('<strong>When:</strong> Tuesday 6 March 2035, 10:00–11:30');
  });

  it('tells each person their part, and who else is involved', () => {
    expect(message.text).toContain('You are taking part in this activity.');
    expect(message.text).toContain('Responsible: Ada Admin');
    expect(message.text).toContain('Also taking part: Chika Staff');

    const responsible = renderReminder({ ...base, details: details({ recipient_name: 'Ada Admin', recipient_role: 'responsible' }) });
    expect(responsible.text).toContain('You are responsible for this activity.');
    expect(responsible.text).not.toContain('Responsible: Ada Admin');

    const informed = renderReminder({ ...base, details: details({ recipient_role: 'notify_only' }) });
    expect(informed.text).toContain('You are listed on this activity to be kept informed.');
  });

  it('describes an all-day activity without a time', () => {
    const allDay = renderReminder({ ...base, details: details({ start_time: null, end_time: null }) });
    expect(allDay.subject).toBe('Reminder: Board meeting, Tuesday 6 March');
    expect(allDay.text).toContain('When: Tuesday 6 March 2035 (all day)');
  });

  it('shows the time zone when the activity is not in office time', () => {
    const london = renderReminder({ ...base, details: details({ timezone: 'Europe/London', end_time: null }) });
    expect(london.text).toContain('When: Tuesday 6 March 2035, 10:00 (Europe/London)');
  });

  it('includes the details, preparation, meeting link and contact person when given', () => {
    const full = renderReminder({
      ...base,
      details: details({
        description: 'Quarterly results\nand budget',
        preparation_notes: 'Read the pack',
        meeting_url: 'https://meet.example/abc',
        contact_name: 'Front desk',
        contact_phone: '+2348012345678',
      }),
    });
    expect(full.html).toContain('Quarterly results<br>and budget');
    expect(full.text).toContain('Preparation:\nRead the pack');
    expect(full.html).toContain('<a href="https://meet.example/abc">');
    expect(full.text).toContain('Contact: Front desk, +2348012345678');
  });

  it('links staff to the activity, but not external contacts (who have no login)', () => {
    expect(message.html).toContain('href="https://office.example/activities/00000000-0000-4000-8000-0000000000a1"');
    const external = renderReminder({ ...base, details: details({ recipient_is_staff: false, recipient_name: 'Partner Contact' }) });
    expect(external.html).not.toContain('office.example');
    expect(external.text).not.toContain('office.example');
    expect(external.text).toContain('Lagos Office listed you on this activity.');
  });

  it('escapes anything people typed, drops unsafe links, and keeps the subject on one line', () => {
    const hostile = renderReminder({
      ...base,
      details: details({
        title: '<script>alert("x")</script>\nSecond line',
        location: 'Room "A" & <b>B</b>',
        meeting_url: 'javascript:alert(1)',
        recipient_name: '<img src=x>',
        others: ['<i>Eve</i>'],
      }),
    });
    expect(hostile.subject).toBe('Reminder: <script>alert("x")</script> Second line, Tuesday 6 March at 10:00');
    expect(hostile.html).not.toContain('<script>');
    expect(hostile.html).not.toContain('<img');
    expect(hostile.html).not.toContain('<i>Eve');
    expect(hostile.html).not.toContain('javascript:');
    expect(hostile.text).not.toContain('javascript:');
    expect(hostile.html).toContain('Room &quot;A&quot; &amp; &lt;b&gt;B&lt;/b&gt;');
  });
});
