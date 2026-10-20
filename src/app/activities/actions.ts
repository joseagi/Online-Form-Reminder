'use server';

import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import {
  activityFormSchema,
  issuesByPath,
  normalizePhone,
  toActivityPayload,
  type ActivityFormValues,
  type ValidActivityForm,
} from '@/lib/activities/schema';
import { createClient } from '@/lib/supabase/server';

export type SaveActivityState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Recipient = { profile_id?: string; contact_id?: string; role: string; notify_email: boolean };

class UserFacingError extends Error {}

// Creates or edits an activity. Everything is validated again here: the browser's checks are
// a convenience, never a guarantee.
export async function saveActivity(_prev: SaveActivityState, input: ActivityFormValues): Promise<SaveActivityState> {
  await requireUser();

  const parsed = activityFormSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'Please correct the highlighted details.', fieldErrors: issuesByPath(parsed.error) };
  }

  const supabase = await createClient();
  let recipients: Recipient[];
  try {
    recipients = await resolvePeople(supabase, parsed.data.people);
  } catch (error) {
    if (error instanceof UserFacingError) return { error: error.message };
    throw error;
  }

  const { data: id, error } = await supabase.rpc('save_activity', {
    p_activity: toActivityPayload(parsed.data),
    p_recipients: recipients,
    p_expected_version: parsed.data.expectedVersion,
  });
  if (error || !id) return { error: saveErrorMessage(error) };

  redirect(`/activities/${id}?notice=saved`);
}

// Error codes come from public.save_activity (see its migration).
function saveErrorMessage(error: { code?: string; message: string } | null): string {
  switch (error?.code) {
    case '40001':
      return 'Someone else saved changes to this activity while you were editing it. Open it again to see their changes, then make yours.';
    case '42501':
      return 'You do not have permission to edit this activity, or it no longer exists.';
    case '22023':
      return error.message;
    default:
      console.error('save_activity failed:', error);
      return 'The activity could not be saved. Please check the details and try again.';
  }
}

// Maps form entries to save_activity's people list, adding new external contacts to the shared
// contact list first (or reusing an existing contact with the same email address).
async function resolvePeople(supabase: Supabase, people: ValidActivityForm['people']): Promise<Recipient[]> {
  const recipients: Recipient[] = [];

  for (const person of people) {
    if (person.kind === 'staff') {
      recipients.push({ profile_id: person.profileId, role: person.role, notify_email: person.notifyEmail });
    } else if (person.kind === 'contact') {
      recipients.push({ contact_id: person.contactId, role: person.role, notify_email: person.notifyEmail });
    } else {
      const contactId = await findOrCreateContact(supabase, person);
      recipients.push({ contact_id: contactId, role: person.role, notify_email: person.notifyEmail });
    }
  }
  return recipients;
}

async function findOrCreateContact(
  supabase: Supabase,
  person: Extract<ValidActivityForm['people'][number], { kind: 'new-contact' }>,
): Promise<string> {
  const email = person.email || null;

  if (email) {
    const existing = await findContactByEmail(supabase, email, person.name);
    if (existing) return existing;
  }

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      full_name: person.name,
      email,
      phone: person.phone ? normalizePhone(person.phone) : null,
      organisation: person.organisation || null,
    })
    .select('id')
    .single();

  if (error?.code === '23505' && email) {
    // Someone added the same email address at the same moment.
    const existing = await findContactByEmail(supabase, email, person.name);
    if (existing) return existing;
  }
  if (error || !data) {
    console.error('Adding a contact failed:', error);
    throw new UserFacingError(`${person.name} could not be added to the contact list.`);
  }
  return data.id;
}

async function findContactByEmail(supabase: Supabase, email: string, name: string): Promise<string | null> {
  const { data, error } = await supabase.from('contacts').select('id, is_active').eq('email', email).maybeSingle();
  if (error) throw new Error(`Could not look up contacts: ${error.message}`);
  if (data && !data.is_active) {
    throw new UserFacingError(`${name} (${email}) is an inactive contact. Ask an administrator to reactivate them.`);
  }
  return data?.id ?? null;
}
