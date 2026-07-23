import { McpConnectionCommands } from '@/components/mcp/McpConnectionCommands';
import { McpConnectionsList } from '@/components/mcp/McpConnectionsList';
import styles from './page.module.css';

export default function McpAccountPage() {
  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <header className={styles.pageHeader}>
          <h1>MCP</h1>
          <p>Connect Keco to an AI coding client and manage access for this account.</p>
        </header>
        <McpConnectionCommands />
        <McpConnectionsList />
      </div>
    </main>
  );
}
