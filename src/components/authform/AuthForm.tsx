"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import loginImg from "@/app/assets/images/loginImg.png";
import { useSupabase } from "@/lib/SupabaseContext";
import styles from "./AuthForm.module.css";
import loginMessageIcon from "@/app/assets/images/loginMessageIcon.svg";
import loginProductIcon from "@/app/assets/images/loginProductIcon.svg";
import loginQuestionIcon from "@/app/assets/images/loginQuestionIcon.svg";
import loginServiceIcon from "@/app/assets/images/loginServiceIcon.svg";
import loginLeftArrowIcon from "@/app/assets/images/loginArrowIcon.svg";

type Mode = "login" | "register";

type RegisterState = {
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
};

type LoginState = {
  email: string;
  password: string;
};

export default function AuthForm() {
  const supabase = useSupabase();
  const [mode, setMode] = useState<Mode>("login");
  const [regForm, setRegForm] = useState<RegisterState>({
    email: "",
    username: "",
    password: "",
    confirmPassword: "",
  });
  const [loginForm, setLoginForm] = useState<LoginState>({
    email: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setMessage(null);
    setErrorMsg(null);
    // Reset form states when switching views
    setRegForm({
      email: "",
      username: "",
      password: "",
      confirmPassword: "",
    });
    setLoginForm({
      email: "",
      password: "",
    });
    setPasswordError(false);
  };

  const updateReg =
    (key: keyof RegisterState) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setRegForm((p) => ({ ...p, [key]: e.target.value }));

  const updateLogin =
    (key: keyof LoginState) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setLoginForm((p) => ({ ...p, [key]: e.target.value }));

  const handleRegister = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage(null);
    setErrorMsg(null);

    const { email, username, password, confirmPassword } = regForm;
    if (!email || !username || !password) {
      setErrorMsg("Email, username and password cannot be empty");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });
      if (error) throw error;
      setMessage("Sign-up succeeded");
    } catch (err: any) {
      setErrorMsg(err?.message || "Sign-up failed");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage(null);
    setErrorMsg(null);
    setPasswordError(false);

    const { email, password } = loginForm;
    if (!email || !password) {
      setErrorMsg("Email and password cannot be empty");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setMessage("Signed in successfully");
      setPasswordError(false);
    } catch (err: any) {
      if(err?.message.includes("Invalid login credentials")) {
        setErrorMsg("Incorrect password, please try again.");
        setPasswordError(true);
      } else {
        setErrorMsg(err?.message || "Sign-in failed");
        setPasswordError(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setMessage(null);
    setErrorMsg(null);
    setGoogleLoading(true);

    try {
      // Ensure we use the current origin (localhost:3000 for dev, vercel.app for prod)
      const currentOrigin = window.location.origin;
      const redirectTo = `${currentOrigin}/auth/callback`;
      
      console.log('Google OAuth redirectTo:', redirectTo);
      console.log('Current origin:', currentOrigin);
      
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });
      if (error) throw error;
      // OAuth 登录会重定向到 Google，所以这里不需要设置成功消息
    } catch (err: any) {
      setErrorMsg(err?.message || "Google 登录失败");
      setGoogleLoading(false);
    }
  };

  const isRegister = mode === "register";

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerLogo}>
            <Image src={loginProductIcon} alt="Logo" width={32} height={32} />
            <div className={styles.headerBrand}>
              <div className={styles.brandName}>Keco Studio</div>
              <div className={styles.brandSlogan}>for game designers</div>
            </div>
          </div>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.headerIconBtn} aria-label="Messages">
            <Image src={loginMessageIcon} alt="Messages" width={20} height={20} />
          </button>
          <button className={styles.headerIconBtn} aria-label="Service">
            <Image src={loginServiceIcon} alt="Service" width={20} height={20} />
          </button>
          <button className={styles.headerIconBtn} aria-label="Question">
            <Image src={loginQuestionIcon} alt="Question" width={20} height={20} />
          </button>
        </div>
      </header>

      <div className={styles.card}>
        <div className={styles.cardInner}>
          <div className={styles.formSide}>
          <button 
            className={styles.backBtn} 
            aria-label="Back"
            onClick={() => switchMode(isRegister ? "login" : "register")}
          >
            <Image src={loginLeftArrowIcon} alt="Back" width={20} height={20} />
          </button>
          <div className={styles.logo}>
            <Image src={loginProductIcon} alt="Logo" width={32} height={32} />
          </div>
          <h1 className={styles.title}>
            {isRegister ? "REGISTER" : (
              <>
                <span className={styles.titleMain}>Login to </span>
                <span className={styles.titleBrand}>Keco</span>
              </>
            )}
          </h1>

          {isRegister ? (
            <form className={styles.form} onSubmit={handleRegister} autoComplete="off">
              {/* Hidden dummy fields to confuse browser autofill */}
              <input type="text" name="fake-email" autoComplete="off" style={{ display: 'none' }} tabIndex={-1} />
              <input type="password" name="fake-password" autoComplete="off" style={{ display: 'none' }} tabIndex={-1} />
              
              <label className={styles.label}>
                Email
                <input
                  className={styles.input}
                  name="reg-email-input"
                  type="text"
                  inputMode="email"
                  placeholder="type your email..."
                  autoComplete="off"
                  value={regForm.email}
                  onChange={updateReg("email")}
                  required
                />
              </label>
              <label className={styles.label}>
                Username
                <input
                  className={styles.input}
                  name="reg-username-input"
                  type="text"
                  placeholder="type your username..."
                  autoComplete="off"
                  value={regForm.username}
                  onChange={updateReg("username")}
                  required
                />
              </label>
              <label className={styles.label}>
                Password
                <input
                  className={styles.input}
                  name="reg-password-input"
                  type="password"
                  placeholder="type your password..."
                  autoComplete="new-password"
                  value={regForm.password}
                  onChange={updateReg("password")}
                  required
                />
              </label>
              <label className={styles.label}>
                Confirm Password
                <input
                  className={styles.input}
                  name="reg-confirm-password-input"
                  type="password"
                  placeholder="type your confirm password..."
                  autoComplete="new-password"
                  value={regForm.confirmPassword}
                  onChange={updateReg("confirmPassword")}
                  required
                />
              </label>
              {errorMsg ? <div className={styles.error}>{errorMsg}</div> : null}
              <button type="submit" className={`${styles.submit} ${styles.submitRegister}`} disabled={loading}>
                {loading ? "Registering..." : "Register"}
              </button>
            </form>
          ) : (
            <>
              <div className={styles.oauthSection}>
                <button
                  type="button"
                  className={styles.googleButton}
                  onClick={handleGoogleLogin}
                  disabled={googleLoading || loading}
                >
                  <svg className={styles.googleIcon} viewBox="0 0 24 24" width="20" height="20">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  <span>{googleLoading ? "正在跳转..." : "使用 Google 登录"}</span>
                </button>
              </div>

              <div className={styles.divider}>
                <span className={styles.dividerText}>或</span>
              </div>

              <form className={styles.form} onSubmit={handleLogin} autoComplete="off">
                {/* Hidden dummy fields to confuse browser autofill */}
                <input type="text" name="fake-username" autoComplete="off" style={{ display: 'none' }} tabIndex={-1} />
                <input type="password" name="fake-password" autoComplete="off" style={{ display: 'none' }} tabIndex={-1} />
                
                <label className={styles.label}>
                  Email
                  <input
                    className={styles.input}
                    name="login-email-input"
                    type="text"
                    inputMode="email"
                    placeholder="type your email..."
                    autoComplete="off"
                    value={loginForm.email}
                    onChange={updateLogin("email")}
                    required
                  />
                </label>
                <label className={styles.label}>
                  Password
                  <input
                    className={`${styles.input} ${passwordError ? styles.inputError : ''}`}
                    name="login-password-input"
                    type="password"
                    placeholder="type your password..."
                    autoComplete="new-password"
                    value={loginForm.password}
                    onChange={(e) => {
                      updateLogin("password")(e);
                      setPasswordError(false);
                    }}
                    required
                  />
                </label>
                {errorMsg ? <div className={styles.error}>{errorMsg}</div> : null}
                <button 
                  type="button" 
                  className={styles.forgotPassword}
                  onClick={() => {
                    window.location.href = '/forgot-password';
                  }}
                >
                  Forget you password?
                </button>
                <button type="submit" className={`${styles.submit} ${styles.submitLogin}`} disabled={loading}>
                  {loading ? "Logging in..." : "Login"}
                </button>
              </form>
            </>
          )}

          {message ? <div className={styles.success}>{message}</div> : null}

          <div className={styles.footer}>
            {isRegister ? (
              <>
                <span className={styles.muted}>Have an account?</span>
                <button className={styles.link} type="button" onClick={() => switchMode("login")}>
                  Login Now
                </button>
              </>
            ) : (
              <>
                <span className={styles.muted}>Don’t have an account?</span>
                <button className={styles.link} type="button" onClick={() => switchMode("register")}>
                  Sign Up Now
                </button>
              </>
            )}
          </div>
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


