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
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showEditFolderModal, setShowEditFolderModal] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [showEditAssetModal, setShowEditAssetModal] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);

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

  return {
    showProjectModal,
    showEditProjectModal,
    editingProjectId,
    showLibraryModal,
    showEditLibraryModal,
    editingLibraryId,
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
    openNewFolder,
    closeFolderModal,
    openEditFolder,
    closeEditFolderModal,
    openEditAsset,
    closeEditAssetModal,
  };
}
