'use client';

import Link from 'next/link';
import {
  startTransition,
  useActionState,
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { saveActivity, type SaveActivityState } from '@/app/activities/actions';
import {
  Alert,
  CheckboxField,
  Field,
  SelectField,
  SubmitButton,
  TextAreaField,
  secondaryButtonStyles,
} from '@/components/ui';
import {
  RECIPIENT_ROLES,
  ROLE_LABELS,
  activityFormSchema,
  issuesByPath,
  newContactPerson,
  personKey,
  type ActivityFormValues,
  type PersonEntry,
  type RecipientRole,
} from '@/lib/activities/schema';
import type { ContactOption, StaffOption } from '@/lib/activities/types';

type Props = {
  mode: 'create' | 'edit';
  initial: ActivityFormValues;
  staffOptions: StaffOption[];
  contactOptions: ContactOption[];
  timezone: string;
  cancelHref: string;
};

export function ActivityForm({ mode, initial, staffOptions, contactOptions, timezone, cancelHref }: Props) {
  const [values, setValues] = useState<ActivityFormValues>(initial);
  const [clientErrors, setClientErrors] = useState<Record<string, string> | null>(null);
  const [state, dispatch, pending] = useActionState<SaveActivityState, ActivityFormValues>(saveActivity, {});

  const errors = clientErrors ?? state.fieldErrors ?? {};
  const summary = clientErrors ? 'Please correct the highlighted details.' : state.error;

  function set<K extends keyof ActivityFormValues>(key: K, value: ActivityFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Submitted by hand rather than through <form action>, so React keeps what was typed when
    // saving fails (for example when someone else edited the activity in the meantime).
    event.preventDefault();
    const result = activityFormSchema.safeParse(values);
    if (!result.success) {
      setClientErrors(issuesByPath(result.error));
      return;
    }
    setClientErrors(null);
    startTransition(() => dispatch(values));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8">
      <Section title="What">
        <Field label="Title" value={values.title} onChange={(e) => set('title', e.target.value)} maxLength={200} required
          error={errors.title} />
        <TextAreaField label="Description" value={values.description} onChange={(e) => set('description', e.target.value)}
          maxLength={5000} error={errors.description} />
      </Section>

      <Section title="When" hint={`Times are in ${timezone}.`}>
        <Field label="Date" type="date" value={values.activityDate} onChange={(e) => set('activityDate', e.target.value)}
          required error={errors.activityDate} />
        <CheckboxField label="All day (no specific time)" checked={values.allDay}
          onChange={(e) => set('allDay', e.target.checked)} />
        {!values.allDay && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start time" type="time" value={values.startTime} onChange={(e) => set('startTime', e.target.value)}
              required error={errors.startTime} />
            <Field label="End time" type="time" value={values.endTime} onChange={(e) => set('endTime', e.target.value)}
              hint="Optional" error={errors.endTime} />
          </div>
        )}
      </Section>

      <Section title="Where">
        <Field label="Location" value={values.location} onChange={(e) => set('location', e.target.value)} maxLength={300}
          error={errors.location} />
        <Field label="Meeting link" type="url" placeholder="https://" value={values.meetingUrl}
          onChange={(e) => set('meetingUrl', e.target.value)} error={errors.meetingUrl} />
      </Section>

      <Section title="People" hint="One staff member is responsible. Collaborators take part; “notify only” people just get reminders.">
        <PeopleEditor people={values.people} onChange={(people) => set('people', people)} staffOptions={staffOptions}
          contactOptions={contactOptions} errors={errors} />
      </Section>

      <Section title="Contact person" hint="Optional: someone to contact about this activity, such as the host.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Contact person’s name" value={values.contactName} onChange={(e) => set('contactName', e.target.value)}
            maxLength={120} error={errors.contactName} />
          <Field label="Contact person’s phone" type="tel" value={values.contactPhone}
            onChange={(e) => set('contactPhone', e.target.value)} maxLength={40} error={errors.contactPhone} />
          <Field label="Contact person’s email" type="email" value={values.contactEmail}
            onChange={(e) => set('contactEmail', e.target.value)} error={errors.contactEmail} />
        </div>
      </Section>

      <Section title="Preparation">
        <TextAreaField label="Preparation notes" hint="Included in reminders and the Sunday summary."
          value={values.preparationNotes} onChange={(e) => set('preparationNotes', e.target.value)} maxLength={5000}
          error={errors.preparationNotes} />
      </Section>

      <Section title="Visibility and reminders">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Who can see this activity</legend>
          <Radio name="visibility" checked={values.visibility === 'office'} onChange={() => set('visibility', 'office')}
            label="Everyone in the office" />
          <Radio name="visibility" checked={values.visibility === 'restricted'} onChange={() => set('visibility', 'restricted')}
            label="Restricted: only the people listed, the creator and administrators" />
        </fieldset>
        <CheckboxField label="Send day-before email reminders" checked={values.remindersEnabled}
          onChange={(e) => set('remindersEnabled', e.target.checked)} />
        <CheckboxField label="Include in the Sunday office summary"
          checked={values.includeInWeeklySummary && values.visibility === 'office'}
          disabled={values.visibility === 'restricted'}
          hint={values.visibility === 'restricted' ? 'Restricted activities are never included.' : undefined}
          onChange={(e) => set('includeInWeeklySummary', e.target.checked)} />
      </Section>

      <div className="space-y-3">
        {summary && <Alert tone="error">{summary}</Alert>}
        <SubmitButton pending={pending}>{mode === 'create' ? 'Create activity' : 'Save changes'}</SubmitButton>
        <p className="text-center text-sm">
          <Link href={cancelHref} className="text-zinc-600 hover:underline dark:text-zinc-400">
            Cancel
          </Link>
        </p>
      </div>
    </form>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint && <p className="text-sm text-zinc-600 dark:text-zinc-400">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Radio({ label, ...input }: { label: string } & Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="radio" className="h-4 w-4" {...input} />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------------------------
// People: staff, saved external contacts, and new external people.

const EXTERNAL_ROLES = ['collaborator', 'notify_only'] as const;
const emptyDraft = { name: '', email: '', phone: '', organisation: '' };

function canEmail(person: PersonEntry): boolean {
  if (person.kind === 'staff') return true;
  if (person.kind === 'contact') return person.hasEmail;
  return person.email.trim() !== '';
}

function PeopleEditor({
  people,
  onChange,
  staffOptions,
  contactOptions,
  errors,
}: {
  people: PersonEntry[];
  onChange: (people: PersonEntry[]) => void;
  staffOptions: StaffOption[];
  contactOptions: ContactOption[];
  errors: Record<string, string>;
}) {
  const [staffChoice, setStaffChoice] = useState('');
  const [contactChoice, setContactChoice] = useState('');
  const [draft, setDraft] = useState(emptyDraft);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});

  const listed = new Set(people.map(personKey));
  const availableStaff = staffOptions.filter((s) => !listed.has(`staff:${s.id}`));
  const availableContacts = contactOptions.filter((c) => !listed.has(`contact:${c.id}`));

  function update(index: number, change: { role?: RecipientRole; notifyEmail?: boolean }) {
    onChange(
      people.map((person, i) => {
        if (i === index) return { ...person, ...change } as PersonEntry;
        // Only one responsible person: choosing a new one makes the previous one a collaborator.
        if (change.role === 'responsible' && person.role === 'responsible') return { ...person, role: 'collaborator' };
        return person;
      }),
    );
  }

  function addStaff() {
    const staff = staffOptions.find((s) => s.id === staffChoice);
    if (!staff) return;
    onChange([...people, { kind: 'staff', profileId: staff.id, name: staff.fullName, role: 'collaborator', notifyEmail: true }]);
    setStaffChoice('');
  }

  function addContact(contact: ContactOption | undefined) {
    if (!contact) return;
    onChange([
      ...people,
      { kind: 'contact', contactId: contact.id, name: contact.fullName, hasEmail: Boolean(contact.email),
        role: 'collaborator', notifyEmail: Boolean(contact.email) },
    ]);
    setContactChoice('');
  }

  function addNewPerson() {
    const candidate: PersonEntry = {
      kind: 'new-contact',
      key: `new-${Date.now()}`,
      ...draft,
      role: 'collaborator',
      notifyEmail: draft.email.trim() !== '',
    };
    const result = newContactPerson.safeParse(candidate);
    if (!result.success) {
      setDraftErrors(issuesByPath(result.error));
      return;
    }

    // Already in the contact list? Use that entry instead of creating a duplicate.
    const email = draft.email.trim().toLowerCase();
    const existing = email ? contactOptions.find((c) => c.email?.toLowerCase() === email) : undefined;
    if (existing && listed.has(`contact:${existing.id}`)) {
      setDraftErrors({ email: `${existing.fullName} is already listed.` });
      return;
    }
    if (existing) addContact(existing);
    else onChange([...people, candidate]);

    setDraft(emptyDraft);
    setDraftErrors({});
  }

  // Enter in the "add someone" fields adds the person instead of submitting the whole form.
  function addOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addNewPerson();
    }
  }

  return (
    <div className="space-y-5">
      {people.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {people.map((person, index) => {
            const rowErrors = Object.entries(errors)
              .filter(([path]) => path.startsWith(`people.${index}.`))
              .map(([, message]) => message);
            return (
              <li key={personKey(person)} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="person-row">
                <span className="min-w-40 flex-1 text-sm font-medium">
                  {person.name}{' '}
                  <span className="text-xs font-normal text-zinc-500">{person.kind === 'staff' ? 'Staff' : 'External'}</span>
                </span>
                <select
                  aria-label={`Role for ${person.name}`}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  value={person.role}
                  onChange={(e) => update(index, { role: e.target.value as RecipientRole })}
                >
                  {(person.kind === 'staff' ? RECIPIENT_ROLES : EXTERNAL_ROLES).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`Email reminder for ${person.name}`}
                    checked={person.notifyEmail}
                    disabled={!canEmail(person)}
                    onChange={(e) => update(index, { notifyEmail: e.target.checked })}
                  />
                  Email reminder
                </label>
                <button type="button" className="text-sm text-red-700 hover:underline dark:text-red-400"
                  aria-label={`Remove ${person.name}`} onClick={() => onChange(people.filter((_, i) => i !== index))}>
                  Remove
                </button>
                {rowErrors.length > 0 && <p className="w-full text-xs text-red-700 dark:text-red-400">{rowErrors.join(' ')}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {errors.people && (
        <p className="text-sm text-red-700 dark:text-red-400" role="alert">
          {errors.people}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <SelectField label="Add a staff member" value={staffChoice} onChange={(e) => setStaffChoice(e.target.value)}
              disabled={availableStaff.length === 0}>
              <option value="">{availableStaff.length ? 'Choose…' : 'Everyone is listed'}</option>
              {availableStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </SelectField>
          </div>
          <button type="button" className={secondaryButtonStyles} aria-label="Add staff member" disabled={!staffChoice}
            onClick={addStaff}>
            Add
          </button>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <SelectField label="Add a saved contact" value={contactChoice} onChange={(e) => setContactChoice(e.target.value)}
              disabled={availableContacts.length === 0}>
              <option value="">{contactOptions.length ? 'Choose…' : 'No saved contacts yet'}</option>
              {availableContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.organisation ? `${c.fullName} (${c.organisation})` : c.fullName}
                </option>
              ))}
            </SelectField>
          </div>
          <button type="button" className={secondaryButtonStyles} aria-label="Add saved contact" disabled={!contactChoice}
            onClick={() => addContact(contactOptions.find((c) => c.id === contactChoice))}>
            Add
          </button>
        </div>
      </div>

      <fieldset className="space-y-3 rounded-md border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
        <legend className="px-1 text-sm font-medium">Add someone from outside the office</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={addOnEnter} maxLength={120} error={draftErrors.name} />
          <Field label="Organisation" value={draft.organisation}
            onChange={(e) => setDraft({ ...draft, organisation: e.target.value })} onKeyDown={addOnEnter} maxLength={200}
            error={draftErrors.organisation} />
          <Field label="Email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            onKeyDown={addOnEnter} error={draftErrors.email} />
          <Field label="Phone" type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            onKeyDown={addOnEnter} hint="International format, e.g. +2348031234567" error={draftErrors.phone} />
        </div>
        <button type="button" className={secondaryButtonStyles} onClick={addNewPerson}>
          Add person
        </button>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          New people are saved to the shared contact list when the activity is saved.
        </p>
      </fieldset>
    </div>
  );
}
