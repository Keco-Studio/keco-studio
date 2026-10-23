import { describe, expect, it } from '@jest/globals';
import { shouldWaitForBlankLibraryBootstrap } from '@/components/libraries/libraryBootstrapState';

describe('blank library bootstrap state', () => {
  it('keeps an editable blank library hidden until its bootstrap fully settles', () => {
    expect(shouldWaitForBlankLibraryBootstrap({
      schemaLoading: false,
      propertyCount: 0,
      canInitialize: true,
      isGeneratedLibrary: false,
      viewingCurrentVersion: true,
      bootstrapStatus: 'idle',
    })).toBe(true);
    expect(shouldWaitForBlankLibraryBootstrap({
      schemaLoading: false,
      propertyCount: 1,
      canInitialize: true,
      isGeneratedLibrary: false,
      viewingCurrentVersion: true,
      bootstrapStatus: 'running',
    })).toBe(true);
    expect(shouldWaitForBlankLibraryBootstrap({
      schemaLoading: false,
      propertyCount: 1,
      canInitialize: true,
      isGeneratedLibrary: false,
      viewingCurrentVersion: true,
      bootstrapStatus: 'settled',
    })).toBe(false);
  });

  it('does not block views that must not initialize blank library data', () => {
    const baseInput = {
      schemaLoading: false,
      propertyCount: 0,
      canInitialize: true,
      isGeneratedLibrary: false,
      viewingCurrentVersion: true,
      bootstrapStatus: 'idle' as const,
    };

    expect(shouldWaitForBlankLibraryBootstrap({
      ...baseInput,
      canInitialize: false,
    })).toBe(false);
    expect(shouldWaitForBlankLibraryBootstrap({
      ...baseInput,
      isGeneratedLibrary: true,
    })).toBe(false);
    expect(shouldWaitForBlankLibraryBootstrap({
      ...baseInput,
      viewingCurrentVersion: false,
    })).toBe(false);
  });
});
