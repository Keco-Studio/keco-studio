'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // 创建 QueryClient 实例，配置缓存策略
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 数据在缓存中保留 2 分钟（在 staleTime 内不会重新请求）
            staleTime: 2 * 60 * 1000,
            // 缓存数据保留 5 分钟
            gcTime: 5 * 60 * 1000,
            // 失败后自动重试 1 次
            retry: 1,
            // 关闭窗口焦点时自动刷新，避免频繁请求
            refetchOnWindowFocus: false,
            // 网络重连时自动刷新
            refetchOnReconnect: true,
            // 挂载时不自动重新获取（如果数据还在缓存中）
            refetchOnMount: false,
            // 启用请求去重：相同 queryKey 的并发请求会自动合并为一个请求
            // 这是 React Query 的默认行为，但明确设置以确保生效
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

