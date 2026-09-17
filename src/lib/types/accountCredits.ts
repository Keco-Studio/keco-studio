export type AccountCreditSummary = {
  allocated: number;
  used: number;
  remaining: number;
  overage: number;
  deepseekTokens: number;
  incompleteCount: number;
  trackedFrom: string;
};
