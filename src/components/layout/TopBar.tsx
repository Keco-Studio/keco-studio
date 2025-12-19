'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import Image from 'next/image';
import { useRef, useState, useEffect } from 'react';
import styles from './TopBar.module.css';
import homeMorehorizontalIcon from '@/app/assets/images/homeMorehorizontalIcon.svg';
import homeQuestionIcon from '@/app/assets/images/homeQuestionIcon.svg';
import homeMessageIcon from '@/app/assets/images/loginMessageIcon.svg';
import homeDefaultUserIcon from '@/app/assets/images/homeDefaultUserIcon.svg';
import topbarPredefinePublishIcon from '@/app/assets/images/topbarPredefinePublishIcon.svg';
import assetViewIcon from '@/app/assets/images/assetViewIcon.svg';
import assetEditIcon from '@/app/assets/images/assetEditIcon.svg';
import assetShareIcon from '@/app/assets/images/assetShareIcon.svg';
import topBarBreadCrumbIcon from '@/app/assets/images/topBarBreadCrumbIcon.svg';

type TopBarProps = {
  breadcrumb?: string[];
};

type AssetMode = 'view' | 'edit';

export function TopBar({ breadcrumb = [] }: TopBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { breadcrumbs, currentAssetId } = useNavigation();
  const { userProfile, signOut } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [assetMode, setAssetMode] = useState<AssetMode>('view');

  // Resolve display name: prefer username, then full_name, then email
  const displayName =
    userProfile?.username || userProfile?.full_name || userProfile?.email || 'Guest';
  const avatarInitial = displayName.charAt(0).toUpperCase();

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  // Reset asset mode when navigating to a different asset
  useEffect(() => {
    setAssetMode('view');
  }, [currentAssetId]);

  // Prefer breadcrumbs from NavigationContext; fall back to the prop-based list
  const displayBreadcrumbs =
    breadcrumbs.length > 0 ? breadcrumbs : breadcrumb.map((label) => ({ label, path: '' }));

  const handleBreadcrumbClick = (path: string, index: number) => {
    // Navigate to the breadcrumb path when it is not the last item
    if (path && index < displayBreadcrumbs.length - 1) {
      router.push(path);
    }
  };

  const handleLogout = async () => {
    setShowUserMenu(false);
    await signOut();
  };

  const isPredefine = pathname?.includes('/predefine');
  const isAssetDetail = !!currentAssetId && !pathname?.includes('/asset/new');

  const handlePredefineSave = () => {
    // Let Predefine page handle actual save via a window event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('predefine-save'));
    }
  };

  const handlePredefinePublish = () => {
    // Placeholder for future publish behavior
    // eslint-disable-next-line no-console
    console.log('Predefine publish clicked');
  };

  const changeAssetMode = (mode: AssetMode) => {
    setAssetMode(mode);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('asset-mode-change', {
          detail: { mode },
        })
      );
    }
  };

  const handleShareClick = () => {
    // Placeholder share behavior
    // eslint-disable-next-line no-console
    console.log('Share asset');
  };

  const renderRightContent = () => {
    if (isPredefine) {
      return (
        <>
          <button
            className={`${styles.topbarPillButton} ${styles.topbarPillPrimary}`}
            onClick={handlePredefineSave}
          >
            <span className={styles.topbarPillIcon}>
              <Image src={topbarPredefinePublishIcon} alt="Save" width={16} height={16} />
            </span>
            <span>Save</span>
          </button>
          <button
            className={styles.topbarPillButton}
            onClick={handlePredefinePublish}
          >
            <span className={styles.topbarPillIcon}>
              <Image src={topbarPredefinePublishIcon} alt="Publish" width={16} height={16} />
            </span>
            <span>Publish</span>
          </button>
        </>
      );
    }

    if (isAssetDetail) {
      return (
        <>
          <div className={styles.assetModeGroup}>
            <button
              className={`${styles.assetModeButton} ${
                assetMode === 'view' ? styles.assetModeButtonActive : ''
              }`}
              onClick={() => changeAssetMode('view')}
            >
              <Image src={assetViewIcon} alt="Viewing" width={16} height={16} />
              <span>Viewing</span>
            </button>
            <button
              className={`${styles.assetModeButton} ${
                assetMode === 'edit' ? styles.assetModeButtonActive : ''
              }`}
              onClick={() => changeAssetMode('edit')}
            >
              <Image src={assetEditIcon} alt="Editing" width={16} height={16} />
              <span>Editing</span>
            </button>
          </div>
          <button
            className={styles.shareButton}
            onClick={handleShareClick}
          >
            <Image src={assetShareIcon} alt="Share" width={16} height={16} />
            <span>Share</span>
          </button>
        </>
      );
    }

    // Default icon group
    return (
      <>
        <button className={`${styles.button} ${styles.buttonText}`}>
          <Image src={homeMorehorizontalIcon} alt="More" width={20} height={20} />
        </button>
        <button className={styles.button}>
          <Image src={homeQuestionIcon} alt="Question" width={20} height={20} />
        </button>
        <button className={styles.button}>
          <Image src={homeMessageIcon} alt="Message" width={20} height={20} />
        </button>
      </>
    );
  };

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <div className={styles.breadcrumb}>
          <Image src={topBarBreadCrumbIcon} alt="Breadcrumb" width={20} height={20} style={{ marginRight: '5px' }}/>
          {displayBreadcrumbs.map((item, index) => (
            <span key={index}>
              <button
                className={`${styles.breadcrumbItem} ${
                  index === displayBreadcrumbs.length - 1
                    ? styles.breadcrumbItemActive
                    : styles.breadcrumbItemClickable
                }`}
                onClick={() => handleBreadcrumbClick(item.path, index)}
                disabled={index === displayBreadcrumbs.length - 1}
              >
                {item.label}
              </button>
              {index < displayBreadcrumbs.length - 1 && (
                <span className={styles.breadcrumbSeparator}> / </span>
              )}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.right}>
        {renderRightContent()}
        <div className={styles.userContainer} ref={menuRef}>
          <div
            className={styles.userAvatar}
            onClick={() => setShowUserMenu(!showUserMenu)}
          >
            {/* Fallback avatar icon */}
            <Image src={homeDefaultUserIcon} alt="User" width={20} height={20} />
          </div>
          {showUserMenu && (
            <div className={styles.userMenu}>
              <button
                type="button"
                className={styles.userMenuItem}
                onClick={handleLogout}
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}


