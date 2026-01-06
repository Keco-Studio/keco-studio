'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import loginImg from '@/app/assets/images/loginImg.png';
import loginLeftArrowIcon from '@/app/assets/images/loginArrowIcon.svg';
import styles from './page.module.css';

export default function ResetPasswordPage() {
  const supabase = useSupabase();
  const router = useRouter();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isValidSession, setIsValidSession] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if there's a valid session (token from email link)
    const checkSession = async () => {
      // Supabase automatically processes the hash from the reset link
      // Wait a moment for Supabase to process the hash and create a session
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (session) {
        setIsValidSession(true);
      } else {
        // Check if there's a hash in the URL (Supabase redirects with hash)
        const hash = window.location.hash;
        if (hash && hash.includes('access_token')) {
          // Wait a bit more for Supabase to process
          await new Promise(resolve => setTimeout(resolve, 1000));
          const { data: { session: retrySession } } = await supabase.auth.getSession();
          if (retrySession) {
            setIsValidSession(true);
          } else {
            setError('Invalid or expired reset link. Please request a new one.');
            setIsValidSession(false);
          }
        } else {
          setError('Invalid reset link. Please request a new password reset.');
          setIsValidSession(false);
        }
      }
    };

    checkSession();
  }, [supabase]);

  const handleBack = () => {
    router.push('/forgot-password');
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      setMessage('Password reset successfully! Redirecting to login...');
      
      // Wait a moment to show success message, then redirect
      setTimeout(() => {
        router.push('/?message=Password reset successfully');
      }, 1500);
    } catch (error: any) {
      setError(error?.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  if (isValidSession === null) {
    // Still checking session
    return (
      <div className={styles.page}>
        <div className={styles.loadingContainer}>
          <div className={styles.loading}>Checking reset link...</div>
        </div>
      </div>
    );
  }

  if (isValidSession === false) {
    // Invalid session, show error
    return (
      <div className={styles.page}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerLogo}>
              <div className={styles.logoSmall}>K</div>
              <div className={styles.headerBrand}>
                <div className={styles.brandName}>Keco Studio</div>
                <div className={styles.brandSlogan}>for game designers</div>
              </div>
            </div>
          </div>
        </header>

        <div className={styles.card}>
          <div className={styles.cardInner}>
            <div className={styles.formSide}>
              <button 
                className={styles.backBtn} 
                aria-label="Back"
                onClick={handleBack}
              >
                <Image src={loginLeftArrowIcon} alt="Back" width={20} height={20} />
              </button>
              
              <h1 className={styles.title}>Reset Password</h1>

              <div className={styles.error}>{error}</div>
              
              <button 
                className={styles.submit}
                onClick={() => router.push('/forgot-password')}
              >
                Request New Reset Link
              </button>
            </div>

            <div className={styles.imageSide}>
              <Image
                src={loginImg}
                alt="Auth illustration"
                fill
                className={styles.image}
                priority
                sizes="(max-width: 960px) 100vw, 50vw"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerLogo}>
            <div className={styles.logoSmall}>K</div>
            <div className={styles.headerBrand}>
              <div className={styles.brandName}>Keco Studio</div>
              <div className={styles.brandSlogan}>for game designers</div>
            </div>
          </div>
        </div>
        <div className={styles.headerRight}>
          {/* Empty for now, can add icons later */}
        </div>
      </header>

      <div className={styles.card}>
        <div className={styles.cardInner}>
          <div className={styles.formSide}>
            <button 
              className={styles.backBtn} 
              aria-label="Back"
              onClick={handleBack}
            >
              <Image src={loginLeftArrowIcon} alt="Back" width={20} height={20} />
            </button>
            
            <h1 className={styles.title}>Forgot Your Password</h1>

            {/* Step Indicator */}
            <div className={styles.stepIndicator}>
              <div className={`${styles.step} ${styles.stepInactive}`}>
                <span className={styles.stepNumber}>1</span>
                <span className={styles.stepText}>Verify</span>
              </div>
              <div className={`${styles.step} ${styles.stepActive}`}>
                <span className={styles.stepNumber}>2</span>
                <span className={styles.stepText}>Change password</span>
              </div>
            </div>

            {/* Change Password Form */}
            <form className={styles.form} onSubmit={handleResetPassword}>
              <label className={styles.label}>
                New password
                <input
                  className={styles.input}
                  type="password"
                  placeholder="type your new password..."
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </label>
              
              <label className={styles.label}>
                Confirm password
                <input
                  className={styles.input}
                  type="password"
                  placeholder="type your confirm password..."
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </label>

              {error && <div className={styles.error}>{error}</div>}
              {message && <div className={styles.success}>{message}</div>}

              <button 
                type="submit" 
                className={styles.submit} 
                disabled={!newPassword || !confirmPassword || loading}
              >
                {loading ? 'Resetting...' : 'Confirm'}
              </button>
            </form>
          </div>

          <div className={styles.imageSide}>
            <Image
              src={loginImg}
              alt="Auth illustration"
              fill
              className={styles.image}
              priority
              sizes="(max-width: 960px) 100vw, 50vw"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

