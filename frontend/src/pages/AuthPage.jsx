import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/** Inline icons (no extra deps) */
function IconLogin(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 7V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M3 12h11m0 0-3-3m3 3-3 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconUserPlus(props) {
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
      <path
        d="M19 8v6m3-3h-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AuthPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState("login"); // "login" | "register"

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
  });

  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === "login";

  const title = useMemo(
    () => (isLogin ? "Welcome back" : "Create your account"),
    [isLogin]
  );

  const switchMode = (next) => {
    setMode(next);
    setError(null);
    setSubmitting(false);
    setForm({ username: "", email: "", password: "" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (isLogin) {
        await login({ email: form.email, password: form.password });
      } else {
        await register({ username: form.username, email: form.email, password: form.password });
      }

      navigate("/");
    } catch (err) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl overflow-hidden ring-1 ring-slate-200 bg-white">
              <img
                src="/logo.png"
                alt="FoodRescue logo"
                className="h-full w-full object-contain"
              />
            </div>
            <span className="text-xl font-bold text-slate-900">FoodRescue</span>
          </div>

          <h1 className="mt-4 text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {isLogin ? "Sign in to continue." : "Create a new account."}
          </p>
        </div>

        {/* Content */}
        <div className="flex flex-col sm:flex-row items-start justify-center gap-4">
          {/* Mobile mode switch (hover doesn't exist on mobile => show text) */}
          <div className="sm:hidden w-full max-w-md mx-auto">
            <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-1">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className={[
                    "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition",
                    isLogin ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600",
                  ].join(" ")}
                >
                  <IconLogin className="h-5 w-5" />
                  Login
                </button>

                <button
                  type="button"
                  onClick={() => switchMode("register")}
                  className={[
                    "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition",
                    !isLogin ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600",
                  ].join(" ")}
                >
                  <IconUserPlus className="h-5 w-5" />
                  Register
                </button>
              </div>
            </div>
          </div>

          {/* Desktop: vertical icon switch OUTSIDE the card (small, not full height) */}
          <div className="hidden sm:block relative">
            <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-1">
              <div className="relative rounded-xl bg-slate-100 p-1">
                {/* active indicator (still a slider) */}
                <div
                  className={[
                    "absolute left-1 right-1 top-1 h-12 rounded-lg bg-white shadow-sm ring-1 ring-slate-200",
                    "transition-transform duration-300 ease-out",
                    isLogin ? "translate-y-0" : "translate-y-12",
                  ].join(" ")}
                />

                <div className="relative grid grid-rows-2">
                  {/* LOGIN icon button */}
                  <button
                    type="button"
                    onClick={() => switchMode("login")}
                    className={[
                      "group relative h-12 w-12 grid place-items-center rounded-lg transition-colors",
                      isLogin ? "text-slate-900" : "text-slate-600 hover:text-slate-900",
                      "focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 hover:cursor-pointer",
                    ].join(" ")}
                    aria-label="Login"
                    title="Login"
                  >
                    <IconLogin className="h-5 w-5" />
                    <span className="sr-only">Login</span>

                    {/* hover label bubble */}
                    <span
                      className={[
                        "pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2",
                        "rounded-lg bg-slate-900 text-white text-xs font-semibold px-2 py-1 shadow",
                        "opacity-0 translate-x-1 transition-all duration-150",
                        "group-hover:opacity-100 group-hover:translate-x-0",
                        "group-focus-visible:opacity-100 group-focus-visible:translate-x-0",
                      ].join(" ")}
                    >
                      Login
                    </span>
                  </button>

                  {/* REGISTER icon button */}
                  <button
                    type="button"
                    onClick={() => switchMode("register")}
                    className={[
                      "group relative h-12 w-12 grid place-items-center rounded-lg transition-colors",
                      !isLogin ? "text-slate-900" : "text-slate-600 hover:text-slate-900",
                      "focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 hover:cursor-pointer",
                    ].join(" ")}
                    aria-label="Register"
                    title="Register"
                  >
                    <IconUserPlus className="h-5 w-5" />
                    <span className="sr-only">Register</span>

                    <span
                      className={[
                        "pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2",
                        "rounded-lg bg-slate-900 text-white text-xs font-semibold px-2 py-1 shadow",
                        "opacity-0 translate-x-1 transition-all duration-150",
                        "group-hover:opacity-100 group-hover:translate-x-0",
                        "group-focus-visible:opacity-100 group-focus-visible:translate-x-0",
                      ].join(" ")}
                    >
                      Register
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Auth card */}
          <div className="w-full max-w-md mx-auto sm:mx-0">
            <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 overflow-hidden">
              <div className="p-6 sm:p-8">
                {isLogin ? (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900">Sign in</h2>
                      <p className="mt-1 text-sm text-slate-600">
                        Use your email and password.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700">
                        Email
                      </label>
                      <input
                        type="email"
                        autoComplete="email"
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="you@example.com"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-slate-200"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700">
                        Password
                      </label>
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        placeholder="••••••••"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-slate-200"
                        required
                      />
                    </div>

                    {error && <p className="text-sm text-red-600">{error}</p>}

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800  hover:cursor-pointer focus:outline-none focus:ring-4 focus:ring-slate-200 disabled:opacity-50"
                    >
                      {submitting ? "Please wait..." : "Sign in"}
                    </button>

                    <p className="text-center text-sm text-slate-600">
                      No account?{" "}
                      <button
                        type="button"
                        onClick={() => switchMode("register")}
                        className="font-semibold text-slate-900 hover:underline hover:cursor-pointer"
                      >
                        Register
                      </button>
                    </p>
                  </form>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900">Create account</h2>
                      <p className="mt-1 text-sm text-slate-600">
                        Fill in your details to sign up.
                      </p>
                    </div>

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
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-slate-200"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700">
                        Email
                      </label>
                      <input
                        type="email"
                        autoComplete="email"
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="you@example.com"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-slate-200"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700">
                        Password
                      </label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        placeholder="••••••••"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-slate-200"
                        required
                      />
                    </div>

                    {error && <p className="text-sm text-red-600">{error}</p>}

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 hover:cursor-pointer focus:outline-none focus:ring-4 focus:ring-slate-200 disabled:opacity-50"
                    >
                      {submitting ? "Please wait..." : "Create account"}
                    </button>

                    <p className="text-center text-sm text-slate-600">
                      Already have an account?{" "}
                      <button
                        type="button"
                        onClick={() => switchMode("login")}
                        className="font-semibold text-slate-900 hover:underline hover:cursor-pointer"
                      >
                        Login
                      </button>
                    </p>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AuthPage;
