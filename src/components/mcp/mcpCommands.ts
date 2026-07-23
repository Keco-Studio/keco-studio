export type McpCommandClient = 'codex' | 'claude';

export interface McpCommand {
  label: string;
  copyLabel: string;
  command: string;
}

const MCP_URL = 'https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp';

export const MCP_COMMANDS: Record<McpCommandClient, McpCommand[]> = {
  codex: [
    {
      label: 'Add Keco MCP',
      copyLabel: 'Copy Add Keco MCP command',
      command: `codex mcp add keco-account --url "${MCP_URL}" --oauth-resource "${MCP_URL}"`,
    },
    {
      label: 'Sign in to Keco',
      copyLabel: 'Copy Sign in to Keco command',
      command: 'codex mcp login keco-account',
    },
  ],
  claude: [
    {
      label: 'Add Keco MCP',
      copyLabel: 'Copy Add Keco MCP command',
      command: `claude mcp add --transport http keco-account "${MCP_URL}"`,
    },
  ],
};
