'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import loginImg from '@/assets/images/loginImg_2.png';
// import loginLeftArrowIcon from '@/assets/images/loginArrowIcon.svg';
import styles from './page.module.css';
import loginMessageIcon from "@/assets/images/loginMessageIcon.svg";
import loginProductIcon from "@/assets/images/loginProductIcon.svg";
import loginQuestionIcon from "@/assets/images/loginQuestionIcon.svg";
import loginServiceIcon from "@/assets/images/loginServiceIcon.svg";
import loginLeftArrowIcon from "@/assets/images/loginArrowIcon.svg";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const supabase = useSupabase();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleBack = () => {
    router.push('/');
  };

  const handleSendResetEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setErrorMsg(null);

    if (!email) {
      setErrorMsg('Email is required');
      return;
    }

    setLoading(true);
    try {
      const redirectTo = `${window.location.origin}/auth/reset-password`;
      
      const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectTo,
      });

      if (error) {
        console.error('Reset password error:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        throw error;
      }

      setMessage('Password reset email sent! Please check your inbox and click the link to reset your password.');
    } catch (error: any) {
      console.error('Failed to send reset email:', error);
      console.error('Error stack:', error?.stack);
      setErrorMsg(error?.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      {/* Header */}
      
      {/* <header className={styles.header}>
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
          
        </div>
      </header> */}

      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerLogo}>
            <Image src={loginProductIcon} alt="Logo" width={32} height={32} className="icon-32" />
            <div className={styles.headerBrand}>
              <div className={styles.brandName}>Keco Studio</div>
              <div className={styles.brandSlogan}>for game designers</div>
            </div>
          </div>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.headerIconBtn} aria-label="Messages">
            <Image src={loginMessageIcon} alt="Messages" width={20} height={20} className="icon-20" />
          </button>
          <button className={styles.headerIconBtn} aria-label="Service">
            <Image src={loginServiceIcon} alt="Service" width={20} height={20} className="icon-20" />
          </button>
          <button className={styles.headerIconBtn} aria-label="Question">
            <Image src={loginQuestionIcon} alt="Question" width={20} height={20} className="icon-20" />
          </button>
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
              <Image src={loginLeftArrowIcon} alt="Back" width={20} height={20} className="icon-20" />
            </button>
            
            <h1 className={styles.title}>Forgot Your Password</h1>

            {/* Step Indicator */}
            <div className={styles.stepIndicator}>
              <div className={`${styles.step} ${styles.stepActive}`}>
                <span className={styles.stepNumber}>1</span>
                <span className={styles.stepText}>Verify</span>
              </div>
              <div className={`${styles.step} ${styles.stepInactive}`}>
                <span className={styles.stepNumber}>2</span>
                <span className={styles.stepText}>Change password</span>
              </div>
            </div>

            {/* Send Reset Email Form */}
            <form className={styles.form} onSubmit={handleSendResetEmail}>
              <label className={styles.label}>
                Email or username
                <input
                  className={styles.input}
                  type="text"
                  inputMode="email"
                  placeholder="type your email or username..."
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              {errorMsg && <div className={styles.error}>{errorMsg}</div>}
              {message && <div className={styles.success}>{message}</div>}

              <button type="submit" className={styles.submit} disabled={!email || loading}>
                {loading ? 'Sending...' : 'Send reset link'}
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

