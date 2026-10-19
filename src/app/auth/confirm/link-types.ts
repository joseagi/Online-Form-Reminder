// Email links this app accepts at /auth/confirm (see supabase/templates/).
export const LINK_TYPES = ['invite', 'recovery'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export function isLinkType(value: unknown): value is LinkType {
  return typeof value === 'string' && (LINK_TYPES as readonly string[]).includes(value);
}
