// Shapes shared by server loaders and client components (no server-only imports here).

export type StaffOption = { id: string; fullName: string; email: string };

export type ContactOption = {
  id: string;
  fullName: string;
  organisation: string | null;
  email: string | null;
  phone: string | null;
};
