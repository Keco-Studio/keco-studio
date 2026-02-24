/**
 * Cache Debugger Utility
 * 缓存调试工具 - 用于开发时监控和调试缓存系统
 */

import { globalRequestCache } from '@/lib/hooks/useRequestCache';

export class CacheDebugger {
  private static requestLog: Array<{
    key: string;
    timestamp: number;
    fromCache: boolean;
  }> = [];

  private static enabled = process.env.NODE_ENV === 'development';

  /**
   * Log a request to track cache hits/misses
   */
  static logRequest(key: string, fromCache: boolean): void {
    if (!this.enabled) return;

    this.requestLog.push({
      key,
      timestamp: Date.now(),
      fromCache,
    });

    // Keep only last 100 requests to avoid memory issues
    if (this.requestLog.length > 100) {
      this.requestLog.shift();
    }

    if (fromCache) {
      console.log(
        `%c[Cache HIT] ${key}`,
        'color: #22c55e; font-weight: bold'
      );
    } else {
      console.log(
        `%c[Cache MISS] ${key}`,
        'color: #f59e0b; font-weight: bold'
      );
    }
  }

  /**
   * Get cache statistics
   */
  static getStats(): {
    totalRequests: number;
    cacheHits: number;
    cacheMisses: number;
    hitRate: number;
  } {
    const totalRequests = this.requestLog.length;
    const cacheHits = this.requestLog.filter((r) => r.fromCache).length;
    const cacheMisses = totalRequests - cacheHits;
    const hitRate = totalRequests > 0 ? (cacheHits / totalRequests) * 100 : 0;

    return {
      totalRequests,
      cacheHits,
      cacheMisses,
      hitRate,
    };
  }

  /**
   * Print cache statistics to console
   */
  static printStats(): void {
    const stats = this.getStats();

    console.group('%c📊 Cache Statistics', 'color: #3b82f6; font-size: 16px; font-weight: bold');
    console.log(`Total Requests: ${stats.totalRequests}`);
    console.log(`%cCache Hits: ${stats.cacheHits}`, 'color: #22c55e');
    console.log(`%cCache Misses: ${stats.cacheMisses}`, 'color: #f59e0b');
    console.log(`%cHit Rate: ${stats.hitRate.toFixed(2)}%`, 'color: #3b82f6; font-weight: bold');
    console.groupEnd();
  }

  /**
   * Get recent requests
   */
  static getRecentRequests(limit: number = 10): Array<{
    key: string;
    timestamp: number;
    fromCache: boolean;
    timeAgo: string;
  }> {
    const now = Date.now();
    return this.requestLog
      .slice(-limit)
      .reverse()
      .map((req) => ({
        ...req,
        timeAgo: this.formatTimeAgo(now - req.timestamp),
      }));
  }

  /**
   * Print recent requests
   */
  static printRecentRequests(limit: number = 10): void {
    const requests = this.getRecentRequests(limit);

    console.group(`%c📋 Recent ${limit} Requests`, 'color: #3b82f6; font-size: 16px; font-weight: bold');
    requests.forEach((req, index) => {
      const status = req.fromCache ? '✅ HIT' : '⚠️ MISS';
      const color = req.fromCache ? '#22c55e' : '#f59e0b';
      console.log(`${index + 1}. %c${status}%c ${req.key} %c(${req.timeAgo})`, 
        `color: ${color}; font-weight: bold`,
        'color: inherit',
        'color: #9ca3af'
      );
    });
    console.groupEnd();
  }

  /**
   * Clear request log
   */
  static clearLog(): void {
    this.requestLog = [];
    console.log('%c🗑️ Request log cleared', 'color: #ef4444; font-weight: bold');
  }

  /**
   * Clear all caches
   */
  static clearCache(): void {
    globalRequestCache.invalidate();
    console.log('%c🗑️ All caches cleared', 'color: #ef4444; font-weight: bold');
  }

  /**
   * Reset everything
   */
  static reset(): void {
    this.clearLog();
    this.clearCache();
    console.log('%c🔄 Cache debugger reset complete', 'color: #3b82f6; font-weight: bold');
  }

  /**
   * Enable/disable debugger
   */
  static setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`%cCache debugger ${enabled ? 'enabled' : 'disabled'}`, 'color: #3b82f6; font-weight: bold');
  }

  /**
   * Format time difference
   */
  private static formatTimeAgo(ms: number): string {
    if (ms < 1000) return `${ms}ms ago`;
    if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
    return `${Math.floor(ms / 60000)}m ago`;
  }

  /**
   * Print help message
   */
  static help(): void {
    console.group('%c💡 Cache Debugger Help', 'color: #3b82f6; font-size: 16px; font-weight: bold');
    console.log('Available commands:');
    console.log('');
    console.log('%cCacheDebugger.printStats()%c - Show cache statistics', 'color: #22c55e', 'color: inherit');
    console.log('%cCacheDebugger.printRecentRequests(10)%c - Show recent 10 requests', 'color: #22c55e', 'color: inherit');
    console.log('%cCacheDebugger.clearLog()%c - Clear request log', 'color: #22c55e', 'color: inherit');
    console.log('%cCacheDebugger.clearCache()%c - Clear all caches', 'color: #22c55e', 'color: inherit');
    console.log('%cCacheDebugger.reset()%c - Reset everything', 'color: #22c55e', 'color: inherit');
    console.log('%cCacheDebugger.setEnabled(true/false)%c - Enable/disable debugger', 'color: #22c55e', 'color: inherit');
    console.log('');
    console.log('💡 Tip: Open Network panel in DevTools to see actual HTTP requests');
    console.groupEnd();
  }
}

// Make it available in browser console for debugging
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).CacheDebugger = CacheDebugger;
  console.log(
    '%c🚀 Cache Debugger loaded! Type CacheDebugger.help() for usage',
    'color: #3b82f6; font-weight: bold; font-size: 14px'
  );
}

export default CacheDebugger;

