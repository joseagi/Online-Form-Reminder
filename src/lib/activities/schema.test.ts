import { describe, expect, it } from 'vitest';
import {
  activityFormSchema,
  emptyActivityForm,
  issuesByPath,
  normalizePhone,
  toActivityPayload,
  type ActivityFormValues,
  type PersonEntry,
} from './schema';

const SADE = '00000000-0000-4000-8000-0000000000f1';
const TUNDE = '00000000-0000-4000-8000-0000000000f2';
const CONTACT = '00000000-0000-4000-8000-000000000c01';

function validForm(overrides: Partial<ActivityFormValues> = {}): ActivityFormValues {
  return {
    ...emptyActivityForm({ profileId: SADE, name: 'Sade Staff' }),
    title: 'Planning meeting',
    activityDate: '2026-11-03',
    startTime: '10:00',
    endTime: '11:00',
    ...overrides,
  };
}

function errorsFor(values: ActivityFormValues) {
  const result = activityFormSchema.safeParse(values);
  return result.success ? {} : issuesByPath(result.error);
}

const tunde: PersonEntry = { kind: 'staff', profileId: TUNDE, name: 'Tunde Staff', role: 'collaborator', notifyEmail: true };

describe('activityFormSchema', () => {
  it('accepts a complete timed activity', () => {
    expect(errorsFor(validForm())).toEqual({});
  });

  it('accepts an all-day activity without times', () => {
    expect(errorsFor(validForm({ allDay: true, startTime: '', endTime: '' }))).toEqual({});
  });

  it.each([
    ['a blank title', { title: '   ' }, 'title', 'Enter a title.'],
    ['no date', { activityDate: '' }, 'activityDate', 'Choose a date.'],
    ['an impossible date', { activityDate: '2026-02-30' }, 'activityDate', 'Choose a date.'],
    ['no start time', { startTime: '' }, 'startTime', 'Choose a start time, or tick “All day”.'],
    ['an end before the start', { startTime: '11:00', endTime: '10:00' }, 'endTime', 'The end time must be after the start time.'],
    ['a non-web meeting link', { meetingUrl: 'javascript:alert(1)' }, 'meetingUrl', 'Enter a full link starting with https://'],
    ['an invalid contact email', { contactEmail: 'not-an-email' }, 'contactEmail', 'Enter a valid email address.'],
  ] as const)('rejects %s', (_label, overrides, path, message) => {
    expect(errorsFor(validForm(overrides as Partial<ActivityFormValues>))[path]).toBe(message);
  });

  it('requires exactly one responsible person', () => {
    const none = validForm({ people: [{ ...tunde }] });
    expect(errorsFor(none).people).toBe('Choose exactly one responsible person.');

    const two = validForm({ people: [...validForm().people, { ...tunde, role: 'responsible' }] });
    expect(errorsFor(two).people).toBe('Choose exactly one responsible person.');
  });

  it('rejects the same person listed twice', () => {
    const values = validForm({ people: [...validForm().people, tunde, { ...tunde, role: 'notify_only' }] });
    expect(errorsFor(values).people).toBe('Tunde Staff is listed twice.');
  });

  it('does not let an external contact be the responsible person', () => {
    const contact = { kind: 'contact', contactId: CONTACT, name: 'Partner', hasEmail: true, role: 'responsible', notifyEmail: true };
    expect(activityFormSchema.safeParse(validForm({ people: [contact as unknown as PersonEntry] })).success).toBe(false);
  });

  describe('new external people', () => {
    const newPerson = (overrides: object): PersonEntry =>
      ({ kind: 'new-contact', key: 'k1', name: 'Chidi Partner', email: '', phone: '', organisation: '',
         role: 'collaborator', notifyEmail: false, ...overrides }) as PersonEntry;

    it('need an email or a phone number', () => {
      const values = validForm({ people: [...validForm().people, newPerson({})] });
      expect(errorsFor(values)['people.1.email']).toBe('Give an email address or a phone number.');
    });

    it('need phone numbers in international format', () => {
      const values = validForm({ people: [...validForm().people, newPerson({ phone: '0803 123 4567' })] });
      expect(errorsFor(values)['people.1.phone']).toBe('Enter the phone number in international format, e.g. +2348031234567.');
      expect(errorsFor(validForm({ people: [...validForm().people, newPerson({ phone: '+234 803 123 4567' })] }))).toEqual({});
    });

    it('cannot get email reminders without an email address', () => {
      const values = validForm({ people: [...validForm().people, newPerson({ phone: '+2348031234567', notifyEmail: true })] });
      expect(errorsFor(values)['people.1.notifyEmail']).toBe('Email reminders need an email address.');
    });
  });

  it('requires the starting version when editing', () => {
    expect(errorsFor(validForm({ id: SADE })).id).toBe('Reload the page and try again.');
    expect(errorsFor(validForm({ id: SADE, expectedVersion: 3 }))).toEqual({});
  });
});

describe('toActivityPayload', () => {
  it('turns blanks into nulls and drops times for all-day activities', () => {
    const parsed = activityFormSchema.parse(validForm({ allDay: true, location: '  ' }));
    expect(toActivityPayload(parsed)).toMatchObject({
      title: 'Planning meeting',
      activity_date: '2026-11-03',
      start_time: null,
      end_time: null,
      location: null,
      visibility: 'office',
    });
    expect(toActivityPayload(parsed)).not.toHaveProperty('id');
  });
});

describe('normalizePhone', () => {
  it('removes spaces, dashes and brackets', () => {
    expect(normalizePhone('+234 (803) 123-4567')).toBe('+2348031234567');
  });
});
