'use client';

import { useRouter } from 'next/navigation';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import Image from 'next/image';
import { useRef, useState, useEffect } from 'react';
import styles from "./TopBar.module.css";
import homeMorehorizontalIcon from "@/app/assets/images/homeMorehorizontalIcon.svg";
import homeQuestionIcon from "@/app/assets/images/homeQuestionIcon.svg";
import homeMessageIcon from "@/app/assets/images/loginMessageIcon.svg";
import homeDefaultUserIcon from "@/app/assets/images/homeDefaultUserIcon.svg";

type TopBarProps = {
  breadcrumb?: string[];
};

export function TopBar({ breadcrumb = [] }: TopBarProps) {
  const router = useRouter();
  const { breadcrumbs } = useNavigation();
  const { userProfile, signOut } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Resolve display name: prefer username, then full_name, then email
  const displayName = userProfile?.username || userProfile?.full_name || userProfile?.email || "Guest";
  const avatarInitial = displayName.charAt(0).toUpperCase();

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showUserMenu]);

  // Prefer breadcrumbs from NavigationContext; fall back to the prop-based list
  const displayBreadcrumbs = breadcrumbs.length > 0 ? breadcrumbs : breadcrumb.map(label => ({ label, path: '' }));

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

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <div className={styles.breadcrumb}>
          {displayBreadcrumbs.map((item, index) => (
            <span key={index}>
              <button
                className={`${styles.breadcrumbItem} ${
                  index === displayBreadcrumbs.length - 1 ? styles.breadcrumbItemActive : styles.breadcrumbItemClickable
                }`}
                onClick={() => handleBreadcrumbClick(item.path, index)}
                disabled={index === displayBreadcrumbs.length - 1}
              >
                {item.label}
              </button>
              {index < displayBreadcrumbs.length - 1 && <span className={styles.breadcrumbSeparator}> / </span>}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.right}>
        <button className={`${styles.button} ${styles.buttonText}`}>
          <Image src={homeMorehorizontalIcon} alt="More" width={20} height={20} />
        </button>
        <button className={styles.button}>
          <Image src={homeQuestionIcon} alt="Question" width={20} height={20} />
        </button>
        <button className={styles.button}>
          <Image src={homeMessageIcon} alt="Message" width={20} height={20} />
        </button>
        <div className={styles.userContainer} ref={menuRef}>
          <div
            className={styles.userAvatar}
            onClick={() => setShowUserMenu(!showUserMenu)}
          >
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


