'use client';

/**
 * Request Caching and Deduplication Hook
 * Prevents duplicate requests and caches results
 */

import { useRef, useCallback } from 'react';

type CacheEntry<T> = {
  data: T;
  timestamp: number;
};

type PendingRequest<T> = Promise<T>;

const CACHE_DURATION = 30000; // 30 seconds

export function useRequestCache<T>() {
  const cacheRef = useRef<Map<string, CacheEntry<T>>>(new Map());
  const pendingRef = useRef<Map<string, PendingRequest<T>>>(new Map());

  const getCacheKey = useCallback((key: string): string => {
    return key;
  }, []);

  const isCacheValid = useCallback((entry: CacheEntry<T>): boolean => {
    return Date.now() - entry.timestamp < CACHE_DURATION;
  }, []);

  const getCached = useCallback((key: string): T | null => {
    const cacheKey = getCacheKey(key);
    const cached = cacheRef.current.get(cacheKey);
    
    if (cached && isCacheValid(cached)) {
      return cached.data;
    }
    
    // Remove expired cache
    if (cached) {
      cacheRef.current.delete(cacheKey);
    }
    
    return null;
  }, [getCacheKey, isCacheValid]);

  const setCached = useCallback((key: string, data: T): void => {
    const cacheKey = getCacheKey(key);
    cacheRef.current.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });
  }, [getCacheKey]);

  const fetchWithCache = useCallback(
    async (key: string, fetcher: () => Promise<T>): Promise<T> => {
      const cacheKey = getCacheKey(key);
      
      // Check cache first
      const cached = getCached(key);
      if (cached !== null) {
        return cached;
      }
      
      // Check if request is already pending
      const pending = pendingRef.current.get(cacheKey);
      if (pending) {
        return pending;
      }
      
      // Create new request
      const request = fetcher().then(
        (data) => {
          setCached(key, data);
          pendingRef.current.delete(cacheKey);
          return data;
        },
        (error) => {
          pendingRef.current.delete(cacheKey);
          throw error;
        }
      );
      
      pendingRef.current.set(cacheKey, request);
      return request;
    },
    [getCacheKey, getCached, setCached]
  );

  const invalidate = useCallback((key?: string): void => {
    if (key) {
      const cacheKey = getCacheKey(key);
      cacheRef.current.delete(cacheKey);
      pendingRef.current.delete(cacheKey);
    } else {
      cacheRef.current.clear();
      pendingRef.current.clear();
    }
  }, [getCacheKey]);

  const clearAll = useCallback((): void => {
    cacheRef.current.clear();
    pendingRef.current.clear();
  }, []);

  return {
    fetchWithCache,
    getCached,
    setCached,
    invalidate,
    clearAll,
  };
}

// Global cache for cross-component deduplication
class GlobalRequestCache {
  private cache = new Map<string, { data: any; timestamp: number }>();
  private pending = new Map<string, Promise<any>>();
  private readonly cacheDuration = CACHE_DURATION;

  async fetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    // Check cache
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data as T;
    }

    // Check pending
    const pending = this.pending.get(key);
    if (pending) {
      return pending as Promise<T>;
    }

    // Create new request
    const request = fetcher().then(
      (data) => {
        this.cache.set(key, { data, timestamp: Date.now() });
        this.pending.delete(key);
        return data;
      },
      (error) => {
        this.pending.delete(key);
        throw error;
      }
    );

    this.pending.set(key, request);
    return request;
  }

  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
      this.pending.delete(key);
    } else {
      this.cache.clear();
      this.pending.clear();
    }
  }

  clearExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.cacheDuration) {
        this.cache.delete(key);
      }
    }
  }
}

export const globalRequestCache = new GlobalRequestCache();

// Clean up expired cache periodically
if (typeof window !== 'undefined') {
  setInterval(() => {
    globalRequestCache.clearExpired();
  }, 60000); // Every minute
}

