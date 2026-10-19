import type { Metadata } from 'next';
import { AuthCard } from '@/components/ui';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = { title: 'Reset password · Office Activities' };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset your password">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
