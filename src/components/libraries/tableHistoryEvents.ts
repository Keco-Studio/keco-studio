export const LIBRARY_TABLE_HISTORY_STATE_EVENT = 'library-table-history-state';
export const LIBRARY_TABLE_HISTORY_COMMAND_EVENT = 'library-table-history-command';

export type LibraryTableHistoryStateDetail = {
  projectId: string;
  libraryId: string;
  canUndo: boolean;
  canRedo: boolean;
};

export type LibraryTableHistoryCommandDetail = {
  projectId: string;
  libraryId: string;
  action: 'undo' | 'redo';
};
