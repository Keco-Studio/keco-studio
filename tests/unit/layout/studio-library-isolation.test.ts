import {
  filterStudioLibraries,
  getStudioLibraryRedirectPath,
} from '@/lib/studioLibraryIsolation';

describe('Studio script-library isolation', () => {
  const libraries = [
    { id: 'regular', document_export_type: null },
    { id: 'table-derived', document_export_type: 'table' },
    { id: 'script-derived', document_export_type: 'script' },
  ];

  it('removes script-derived libraries from Studio collections', () => {
    expect(filterStudioLibraries(libraries).map((library) => library.id)).toEqual([
      'regular',
      'table-derived',
    ]);
  });

  it('redirects script-derived Studio routes into Script only', () => {
    expect(getStudioLibraryRedirectPath('project', libraries[2])).toBe(
      '/script-system/project/script/script-derived'
    );
    expect(getStudioLibraryRedirectPath('project', libraries[1])).toBeNull();
    expect(getStudioLibraryRedirectPath('project', null)).toBeNull();
  });
});
