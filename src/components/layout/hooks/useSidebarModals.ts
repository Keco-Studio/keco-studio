'use client';

import { useState, useCallback } from 'react';

/**
 * Centralizes visible and editing-id state for Sidebar modals
 * (new/edit project, library, folder, asset).
 */
export function useSidebarModals() {
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showEditLibraryModal, setShowEditLibraryModal] = useState(false);
  const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null);
  const [showDuplicateLibraryModal, setShowDuplicateLibraryModal] = useState(false);
  const [duplicatingLibraryId, setDuplicatingLibraryId] = useState<string | null>(null);
  const [showExportLibraryModal, setShowExportLibraryModal] = useState(false);
  const [exportingLibraryId, setExportingLibraryId] = useState<string | null>(null);
  const [showImportLibraryModal, setShowImportLibraryModal] = useState(false);
  const [importingFolderId, setImportingFolderId] = useState<string | null>(null);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showEditFolderModal, setShowEditFolderModal] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [showEditAssetModal, setShowEditAssetModal] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [showImportScriptModal, setShowImportScriptModal] = useState(false);
  const [importingScriptFolderId, setImportingScriptFolderId] = useState<string | null>(null);
  const [showDocumentModal, setShowDocumentModal] = useState(false);

  const openNewProject = useCallback(() => setShowProjectModal(true), []);
  const closeProjectModal = useCallback(() => setShowProjectModal(false), []);
  const openEditProject = useCallback((id: string) => {
    setEditingProjectId(id);
    setShowEditProjectModal(true);
  }, []);
  const closeEditProjectModal = useCallback(() => {
    setShowEditProjectModal(false);
    setEditingProjectId(null);
  }, []);

  const openNewLibrary = useCallback(() => setShowLibraryModal(true), []);
  const closeLibraryModal = useCallback(() => setShowLibraryModal(false), []);
  const openEditLibrary = useCallback((id: string) => {
    setEditingLibraryId(id);
    setShowEditLibraryModal(true);
  }, []);
  const closeEditLibraryModal = useCallback(() => {
    setShowEditLibraryModal(false);
    setEditingLibraryId(null);
  }, []);

  const openDuplicateLibrary = useCallback((id: string) => {
    setDuplicatingLibraryId(id);
    setShowDuplicateLibraryModal(true);
  }, []);
  const closeDuplicateLibraryModal = useCallback(() => {
    setShowDuplicateLibraryModal(false);
    setDuplicatingLibraryId(null);
  }, []);

  const openExportLibrary = useCallback((id: string) => {
    setExportingLibraryId(id);
    setShowExportLibraryModal(true);
  }, []);
  const closeExportLibraryModal = useCallback(() => {
    setShowExportLibraryModal(false);
    setExportingLibraryId(null);
  }, []);

  const openImportLibrary = useCallback((folderId: string | null) => {
    setImportingFolderId(folderId);
    setShowImportLibraryModal(true);
  }, []);
  const closeImportLibraryModal = useCallback(() => {
    setShowImportLibraryModal(false);
    setImportingFolderId(null);
  }, []);

  const openNewFolder = useCallback(() => setShowFolderModal(true), []);
  const closeFolderModal = useCallback(() => setShowFolderModal(false), []);
  const openEditFolder = useCallback((id: string) => {
    setEditingFolderId(id);
    setShowEditFolderModal(true);
  }, []);
  const closeEditFolderModal = useCallback(() => {
    setShowEditFolderModal(false);
    setEditingFolderId(null);
  }, []);

  const openEditAsset = useCallback((id: string) => {
    setEditingAssetId(id);
    setShowEditAssetModal(true);
  }, []);
  const closeEditAssetModal = useCallback(() => {
    setShowEditAssetModal(false);
    setEditingAssetId(null);
  }, []);

  const openImportScript = useCallback((folderId: string) => {
    setImportingScriptFolderId(folderId);
    setShowImportScriptModal(true);
  }, []);
  const closeImportScriptModal = useCallback(() => {
    setShowImportScriptModal(false);
    setImportingScriptFolderId(null);
  }, []);

  const openNewDocument = useCallback(() => setShowDocumentModal(true), []);
  const closeDocumentModal = useCallback(() => setShowDocumentModal(false), []);

  return {
    showProjectModal,
    showEditProjectModal,
    editingProjectId,
    showLibraryModal,
    showEditLibraryModal,
    editingLibraryId,
    showDuplicateLibraryModal,
    duplicatingLibraryId,
    showExportLibraryModal,
    exportingLibraryId,
    showImportLibraryModal,
    importingFolderId,
    showFolderModal,
    showEditFolderModal,
    editingFolderId,
    showEditAssetModal,
    editingAssetId,
    openNewProject,
    closeProjectModal,
    openEditProject,
    closeEditProjectModal,
    openNewLibrary,
    closeLibraryModal,
    openEditLibrary,
    closeEditLibraryModal,
    openDuplicateLibrary,
    closeDuplicateLibraryModal,
    openExportLibrary,
    closeExportLibraryModal,
    openImportLibrary,
    closeImportLibraryModal,
    openNewFolder,
    closeFolderModal,
    openEditFolder,
    closeEditFolderModal,
    openEditAsset,
    closeEditAssetModal,
    showImportScriptModal,
    importingScriptFolderId,
    openImportScript,
    closeImportScriptModal,
    showDocumentModal,
    openNewDocument,
    closeDocumentModal,
  };
}
