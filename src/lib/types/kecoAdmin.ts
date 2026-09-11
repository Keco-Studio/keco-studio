export type KecoAdminUserStatus = 'active' | 'suspended';

export type KecoAdminUser = {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  status: KecoAdminUserStatus;
};

export type KecoAdminOverview = {
  totalUsers: number;
  refreshedAt: string;
  users: KecoAdminUser[];
};
