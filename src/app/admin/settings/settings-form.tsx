'use client';

import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, CheckboxField, Field, SelectField, SubmitButton } from '@/components/ui';
import { issuesByPath } from '@/lib/activities/schema';
import { settingsSchema, type SettingsForm } from '@/lib/admin/settings';
import { saveSettings, type SettingsState } from './actions';

const MODE_HELP = {
  off: 'Nothing is sent. Messages that fall due are skipped and logged.',
  test: 'Nothing reaches real recipients. Messages go to the test address below or, without one, are only logged. "Send test to me" still goes to you.',
  live: 'Real messages to real people. Takes effect only on a server set up for live sending; otherwise the system stays in test mode and says so on the Notifications page.',
} as const;

export function SettingsFormView({ initial, timezone }: { initial: SettingsForm; timezone: string }) {
  const [values, setValues] = useState<SettingsForm>(initial);
  const [clientErrors, setClientErrors] = useState<Record<string, string> | null>(null);
  const [state, dispatch, pending] = useActionState<SettingsState, SettingsForm>(saveSettings, {});

  const errors = clientErrors ?? state.fieldErrors ?? {};
  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => setValues((v) => ({ ...v, [key]: value }));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = settingsSchema.safeParse(values);
    if (!result.success) {
      setClientErrors(issuesByPath(result.error));
      return;
    }
    setClientErrors(null);
    startTransition(() => dispatch(values));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-2xl space-y-8">
      <Section title="Office">
        <Field label="Office name" value={values.officeName} onChange={(e) => set('officeName', e.target.value)}
          maxLength={120} error={errors.officeName} hint="Shown in email subjects and the summary." />
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Office time zone: {timezone}</p>
      </Section>

      <Section title="Weekly summary">
        <CheckboxField label="Send the Sunday office summary" checked={values.summaryEnabled}
          onChange={(e) => set('summaryEnabled', e.target.checked)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Send time on Sunday" type="time" value={values.summarySendTime}
            onChange={(e) => set('summarySendTime', e.target.value)} error={errors.summarySendTime}
            hint={`In ${timezone}.`} />
          <Field label="Latest it may go out (hours after the send time)" type="number" min={0} max={24}
            value={values.summaryLateCutoffHours}
            onChange={(e) => set('summaryLateCutoffHours', e.target.value === '' ? Number.NaN : Number(e.target.value))}
            error={errors.summaryLateCutoffHours}
            hint="If the system was down, a late summary is still sent within this window; after it, it is skipped." />
        </div>
        <CheckboxField label="Send it even when nothing is scheduled that week" checked={values.summarySendIfEmpty}
          onChange={(e) => set('summarySendIfEmpty', e.target.checked)} />
      </Section>

      <Section title="Sending">
        <SelectField label="Notification mode" value={values.notificationMode}
          onChange={(e) => set('notificationMode', e.target.value as SettingsForm['notificationMode'])}
          hint={MODE_HELP[values.notificationMode]}>
          <option value="off">Off</option>
          <option value="test">Test</option>
          <option value="live">Live</option>
        </SelectField>
        <Field label="Test address" type="email" value={values.testRedirectEmail}
          onChange={(e) => set('testRedirectEmail', e.target.value)} error={errors.testRedirectEmail}
          hint="In test mode, every message goes here instead. Leave empty to only log them." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sender name" value={values.emailFromName} onChange={(e) => set('emailFromName', e.target.value)}
            maxLength={80} error={errors.emailFromName} />
          <Field label="Reply-to address" type="email" value={values.emailReplyTo}
            onChange={(e) => set('emailReplyTo', e.target.value)} error={errors.emailReplyTo}
            hint="Optional: where replies to notifications go." />
        </div>
      </Section>

      <div className="space-y-3">
        {(clientErrors || state.error) && (
          <Alert tone="error">{clientErrors ? 'Please correct the highlighted settings.' : state.error}</Alert>
        )}
        {!clientErrors && state.message && <Alert tone="success">{state.message}</Alert>}
        <div className="max-w-xs">
          <SubmitButton pending={pending}>Save settings</SubmitButton>
        </div>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
