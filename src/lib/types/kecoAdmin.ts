export type KecoAdminUserStatus = 'active' | 'suspended';

export type KecoAdminUserCreditUsage = {
  creditAllocated: number;
  creditUsed: number;
  creditRemaining: number;
  creditOverage: number;
  deepseekTokens: number;
  creditUsageIncompleteCount: number;
};

export type KecoAdminCreditUsage = {
  allocated: number;
  used: number;
  remaining: number;
  overage: number;
  deepseekTokens: number;
  incompleteCount: number;
  trackedFrom: string;
};

export type KecoAdminUser = KecoAdminUserCreditUsage & {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  status: KecoAdminUserStatus;
};

export type KecoAdminOverview = {
  totalUsers: number;
  creditUsage: KecoAdminCreditUsage;
  refreshedAt: string;
  users: KecoAdminUser[];
};
