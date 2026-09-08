'use client';

import React, { useMemo, useState } from 'react';
import { Checkbox, Input, Select } from 'antd';
import type { Library } from '@/lib/services/libraryService';
import type { Folder } from '@/lib/services/folderService';
import styles from './ReferenceLibrarySelect.module.css';

export type ReferenceLibrarySelectProps = {
  value: string[];
  onChange: (libraryIds: string[]) => void;
  libraries: Library[];
  folders: Folder[];
  loading?: boolean;
  getPopupContainer?: () => HTMLElement;
};

const ChevronIcon = (
  <svg width="12" height="7" viewBox="0 0 12 7" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M0.75 0.75L5.75 5.75L10.75 0.75"
      stroke="#21272A"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SearchIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M11 19C15.4183 19 19 15.4183 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M20.9999 20.9999L16.6499 16.6499"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function ReferenceLibrarySelect({
  value,
  onChange,
  libraries,
  folders,
  loading = false,
  getPopupContainer,
}: ReferenceLibrarySelectProps) {
  const [folderFilter, setFolderFilter] = useState<'all' | 'root' | string>('all');
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const { librariesWithFolder, librariesWithoutFolder, foldersById } = useMemo(() => {
    const byId = new Map<string, Folder>();
    folders.forEach((folder) => byId.set(folder.id, folder));

    const withFolder: Library[] = [];
    const withoutFolder: Library[] = [];
    libraries.forEach((lib) => {
      if (lib.folder_id && byId.has(lib.folder_id)) withFolder.push(lib);
      else withoutFolder.push(lib);
    });

    return {
      librariesWithFolder: withFolder,
      librariesWithoutFolder: withoutFolder,
      foldersById: byId,
    };
  }, [folders, libraries]);

  const filteredLibraries = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const base = libraries.filter((lib) => {
      if (folderFilter === 'all') return true;
      if (folderFilter === 'root') return !lib.folder_id || !foldersById.has(lib.folder_id);
      return lib.folder_id === folderFilter;
    });
    if (!keyword) return base;
    return base.filter((lib) => {
      const name = lib.name.toLowerCase();
      const folderName = lib.folder_id
        ? foldersById.get(lib.folder_id)?.name.toLowerCase() ?? ''
        : '';
      return name.includes(keyword) || folderName.includes(keyword);
    });
  }, [libraries, folderFilter, search, foldersById]);

  const toggleLibrary = (libraryId: string, checked: boolean) => {
    const next = checked
      ? [...value, libraryId]
      : value.filter((id) => id !== libraryId);
    onChange(Array.from(new Set(next)));
  };

  return (
    <div className={styles.field}>
      <label className={styles.label}>
        Reference libraries<span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>
      </label>
      <Select
        mode="multiple"
        className={styles.referenceSelect}
        style={{ width: '100%' }}
        placeholder="Select libraries to reference"
        suffixIcon={ChevronIcon}
        value={value}
        loading={loading}
        onChange={(values) => onChange(values as string[])}
        getPopupContainer={getPopupContainer}
        options={libraries.map((lib) => ({
          label: lib.name,
          value: lib.id,
        }))}
        maxTagCount={2}
        maxTagPlaceholder={(omitted) => (
          <span
            className={styles.maxTagOverflow}
            title={omitted.map((item) => String(item.label ?? item.value)).join(', ')}
          >
            +{omitted.length}
          </span>
        )}
        open={dropdownOpen}
        onOpenChange={(open) => {
          setDropdownOpen(open);
          if (!open) {
            setFolderFilter('all');
            setSearch('');
          }
        }}
        popupRender={() => (
          <div className={styles.referenceDropdown}>
            <div className={styles.dropdownContextHint}>Library</div>
            <div className={styles.referenceDropdownContent}>
              <Input
                allowClear
                placeholder="Search libraries"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={styles.referenceSearchInput}
                prefix={SearchIcon}
              />
              <div className={styles.referenceFolderTabs}>
                <button
                  type="button"
                  className={`${styles.referenceFolderTab} ${
                    folderFilter === 'all' ? styles.referenceFolderTabActive : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFolderFilter('all');
                  }}
                >
                  All folders
                </button>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    className={`${styles.referenceFolderTab} ${
                      folderFilter === folder.id ? styles.referenceFolderTabActive : ''
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFolderFilter(folder.id);
                    }}
                  >
                    {folder.name}
                  </button>
                ))}
                {librariesWithoutFolder.length > 0 && (
                  <button
                    type="button"
                    className={`${styles.referenceFolderTab} ${
                      folderFilter === 'root' ? styles.referenceFolderTabActive : ''
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFolderFilter('root');
                    }}
                  >
                    No folder
                  </button>
                )}
              </div>
              <div className={styles.referenceOptionsList}>
                {loading ? (
                  <div className={styles.referenceEmptyHint}>Loading libraries…</div>
                ) : filteredLibraries.length === 0 ? (
                  <div className={styles.referenceEmptyHint}>No libraries found.</div>
                ) : (
                  filteredLibraries.map((lib) => {
                    const checked = value.includes(lib.id);
                    const folderName =
                      lib.folder_id && foldersById.get(lib.folder_id)
                        ? foldersById.get(lib.folder_id)!.name
                        : librariesWithFolder.length > 0
                          ? 'No folder'
                          : '';
                    return (
                      <label
                        key={lib.id}
                        className={styles.referenceOptionRow}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={checked}
                          onChange={(e) => toggleLibrary(lib.id, e.target.checked)}
                        />
                        <span className={styles.referenceOptionLabel}>{lib.name}</span>
                        {folderName ? (
                          <span className={styles.referenceOptionFolderTag}>{folderName}</span>
                        ) : null}
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      />
      {!loading && value.length === 0 && (
        <span className={styles.hint}>
          Choose one or more libraries that this column can reference.
        </span>
      )}
    </div>
  );
}
