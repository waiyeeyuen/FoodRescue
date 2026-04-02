import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

function IconUser(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M15 21a6 6 0 0 0-12 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function IconStore(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 10.5 5.8 5h12.4l1.8 5.5M6 10.5h12v8.5H6z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 10.5h17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RoleToggle({ userType, onChange, compact = false }) {
  const options = [
    {
      id: "user",
      label: "User",
      hint: "Personal account",
      icon: IconUser,
    },
    {
      id: "restaurant",
      label: "Restaurant",
      hint: "Business account",
      icon: IconStore,
    },
  ];

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {compact ? "Sign in as" : "Choose account type"}
      </p>
      <div className={`grid gap-3 ${compact ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2"}`}>
        {options.map((option) => {
          const Icon = option.icon;
          const active = userType === option.id;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={[
                "rounded-[22px] border p-4 text-left transition-all duration-200",
                compact ? "min-h-[5.75rem]" : "min-h-[6.5rem]",
                active
                  ? "border-[var(--brand-ink)] bg-[rgba(20,95,89,0.12)] shadow-[0_20px_40px_-28px_rgba(20,95,89,0.8)] ring-2 ring-[rgba(20,95,89,0.12)]"
                  : "border-white/70 bg-white/82 hover:border-[rgba(20,95,89,0.25)] hover:bg-white",
              ].join(" ")}
              aria-pressed={active}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-base font-semibold text-slate-900">{option.label}</p>
                  <p className="text-xs text-slate-500">{option.hint}</p>
                </div>
                <div
                  className={[
                    "flex h-10 w-10 items-center justify-center rounded-2xl border",
                    active
                      ? "border-[rgba(20,95,89,0.24)] bg-[rgba(20,95,89,0.12)] text-[var(--brand-ink)]"
                      : "border-slate-200 bg-slate-50 text-slate-500",
                  ].join(" ")}
                >
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AuthPage() {
  const { login, register, restaurantLogin, restaurantRegister } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState("login");
  const [userType, setUserType] = useState("user");
  const [form, setForm] = useState({
    username: "",
    restaurantName: "",
    email: "",
    password: "",
  });
  const [errorMessage, setErrorMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState(null);

  const isLogin = mode === "login";
  const isRestaurant = userType === "restaurant";

  const title = useMemo(() => {
    if (isLogin) return "Sign in";
    return isRestaurant ? "Register your restaurant" : "Create your account";
  }, [isLogin, isRestaurant]);

  const subtitle = useMemo(() => {
    if (isLogin) return "Use your email and password to continue.";
    return isRestaurant
      ? "Set up your restaurant account to start listing rescue meals."
      : "Create a customer account to start rescuing meals nearby.";
  }, [isLogin, isRestaurant]);

  const resetForm = () => {
    setForm({ username: "", restaurantName: "", email: "", password: "" });
  };

  const switchMode = (next) => {
    setMode(next);
    setErrorMessage(null);
    setSubmitting(false);
    resetForm();
  };

  const switchUserType = (next) => {
    setUserType(next);
    setErrorMessage(null);
    setSubmitting(false);
    resetForm();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      if (isLogin) {
        if (isRestaurant) {
          await restaurantLogin({ email: form.email, password: form.password });
        } else {
          await login({ email: form.email, password: form.password });
        }
        navigate("/");
        return;
      }

      if (isRestaurant) {
        await restaurantRegister({
          restaurantName: form.restaurantName,
          email: form.email,
          password: form.password,
        });
      } else {
        await register({
          username: form.username,
          email: form.email,
          password: form.password,
        });
      }

      setSuccessMessage(
        `Registration successful! Please sign in with your ${userType === "restaurant" ? "restaurant " : ""}account.`
      );
      resetForm();
      setMode("login");
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setErrorMessage(err?.message || "Something went wrong.");
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="site-shell flex min-h-screen items-center justify-center px-4 py-5 sm:px-6">
      {successMessage && (
        <div className="site-popover fixed right-4 top-4 z-50 max-w-sm rounded-[24px] border border-green-200/80 bg-green-50/95 p-4">
          <p className="text-sm font-medium text-green-800">{successMessage}</p>
        </div>
      )}

      {errorMessage && (
        <div className="site-popover fixed right-4 top-4 z-50 max-w-sm rounded-[24px] border border-red-200/80 bg-red-50/95 p-4">
          <p className="text-sm font-medium text-red-800">{errorMessage}</p>
        </div>
      )}

      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-2.5">
            <div className="flex items-center gap-3">
              <div className="site-brand-mark flex h-14 w-14 items-center justify-center overflow-hidden rounded-[1.5rem] border border-white/80">
                <img
                  src="/logo.png"
                  alt="FoodRescue logo"
                  className="h-full w-full object-contain"
                />
              </div>
              <p className="site-brand-wordmark text-3xl font-semibold text-slate-900">
                FoodRescue
              </p>
            </div>
            <p className="mx-auto max-w-xs text-sm leading-6 text-slate-600 sm:text-base">
              Fast surplus meal pickups.
            </p>
          </div>
        </div>

        <div className="w-full">
          <div className="spotlight-panel overflow-hidden rounded-[32px]">
              <div className="h-1.5 bg-gradient-to-r from-[var(--brand-coral)] via-[var(--brand-gold)] to-[var(--brand-ink)]" />
              <div className="p-5 sm:p-6">
                <div>
                  <h1 className="text-[1.85rem] font-bold text-slate-900 sm:text-[2.1rem]">{title}</h1>
                  <p className="mt-1.5 text-sm text-slate-600">{subtitle}</p>
                </div>

                <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
                  <RoleToggle userType={userType} onChange={switchUserType} compact={isLogin} />

                  {!isLogin && isRestaurant && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700">
                        Restaurant Name
                      </label>
                      <input
                        type="text"
                        value={form.restaurantName}
                        onChange={(e) => setForm((f) => ({ ...f, restaurantName: e.target.value }))}
                        placeholder="e.g. Warung Makan"
                        className="mt-1 w-full rounded-[18px] border border-slate-200 bg-white/92 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-[rgba(238,127,88,0.16)]"
                        required
                      />
                    </div>
                  )}

                  {!isLogin && !isRestaurant && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700">
                        Username
                      </label>
                      <input
                        type="text"
                        autoComplete="username"
                        value={form.username}
                        onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                        placeholder="janedoe"
                        className="mt-1 w-full rounded-[18px] border border-slate-200 bg-white/92 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-[rgba(238,127,88,0.16)]"
                        required
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-slate-700">Email</label>
                    <input
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="you@example.com"
                      className="mt-1 w-full rounded-[18px] border border-slate-200 bg-white/92 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-[rgba(238,127,88,0.16)]"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700">Password</label>
                    <input
                      type="password"
                      autoComplete={isLogin ? "current-password" : "new-password"}
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      placeholder="••••••••"
                      className="mt-1 w-full rounded-[18px] border border-slate-200 bg-white/92 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-[rgba(238,127,88,0.16)]"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-[18px] bg-[var(--brand-ink)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_22px_42px_-26px_rgba(20,95,89,0.85)] hover:cursor-pointer hover:bg-[#0f4d48] focus:outline-none focus:ring-4 focus:ring-[rgba(20,95,89,0.18)] disabled:opacity-50"
                  >
                    {submitting
                      ? "Please wait..."
                      : isLogin
                        ? "Sign in"
                        : isRestaurant
                          ? "Register restaurant"
                          : "Create account"}
                  </button>

                  <p className="text-center text-sm text-slate-600">
                    {isLogin ? "No account?" : "Already have an account?"}{" "}
                    <button
                      type="button"
                      onClick={() => switchMode(isLogin ? "register" : "login")}
                      className="font-semibold text-slate-900 hover:underline hover:cursor-pointer"
                    >
                      {isLogin ? "Register" : "Login"}
                    </button>
                  </p>
                </form>
              </div>
            </div>
        </div>
      </div>
    </div>
  );
}

export default AuthPage;
