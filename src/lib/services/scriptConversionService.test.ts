import { describe, expect, it, jest } from '@jest/globals';
jest.mock('@/lib/story-plan/conversion', () => ({ resolveStoryPlanForImport: jest.fn() }));
jest.mock('./scriptTextConversion', () => ({ resolveScriptTextForImport: jest.fn() }));
import { resolveStoryPlanForImport } from '@/lib/story-plan/conversion';
import { resolveScriptTextForImport } from './scriptTextConversion';
import { resolveStoryForImport } from './scriptConversionService';
describe('conversion dispatch', () => {
  it('uses Script text for opted-in imports and preserves the existing GDD pipeline', () => {
    resolveStoryForImport('raw', { scriptTextSyntax: true });
    expect(resolveScriptTextForImport).toHaveBeenCalledWith('raw', {});
    resolveStoryForImport('gdd');
    expect(resolveStoryPlanForImport).toHaveBeenCalledWith('gdd', {});
  });
});
