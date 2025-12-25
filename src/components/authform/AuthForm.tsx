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
                  // TODO: Implement forgot password functionality
                }}
              >
                Forget you password?
              </button>
              <button type="submit" className={`${styles.submit} ${styles.submitLogin}`} disabled={loading}>
                {loading ? "Logging in..." : "Login"}
              </button>
            </form>
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


