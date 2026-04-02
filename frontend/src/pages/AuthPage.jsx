import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

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

function IconStore(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 3v4m8-1h2m-2 8h2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="11" r="4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function AuthPage() {
  const { login, register, restaurantLogin, restaurantRegister } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState("login"); // "login" | "register"
  const [userType, setUserType] = useState("user"); // "user" | "restaurant"

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

  const title = useMemo(
    () => {
      if (isLogin) return "Welcome back";
      return isRestaurant ? "Register your restaurant" : "Create your account";
    },
    [isLogin, isRestaurant]
  );

  const switchMode = (next) => {
    setMode(next);
    setErrorMessage(null);
    setSubmitting(false);
    setForm({ username: "", restaurantName: "", email: "", password: "" });
  };

  const switchUserType = (next) => {
    setUserType(next);
    setErrorMessage(null);
    setSubmitting(false);
    setForm({ username: "", restaurantName: "", email: "", password: "" });
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
      } else {
        // Registration - show success notification
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
        
        // Show success notification
        setSuccessMessage(`Registration successful! Please sign in with your ${userType === "restaurant" ? "restaurant" : ""} account.`);
        setForm({ username: "", restaurantName: "", email: "", password: "" });
        setMode("login");
        
        // Clear success message after 5 seconds
        setTimeout(() => setSuccessMessage(null), 5000);
      }
    } catch (err) {
      setErrorMessage(err?.message || "Something went wrong.");
      // Clear error message after 5 seconds
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      {/* Success notification */}
      {successMessage && (
        <div className="fixed top-4 right-4 bg-green-50 border border-green-200 rounded-lg p-4 shadow-lg max-w-sm">
          <p className="text-sm font-medium text-green-800">{successMessage}</p>
        </div>
      )}

      {/* Error notification */}
      {errorMessage && (
        <div className="fixed top-4 right-4 bg-red-50 border border-red-200 rounded-lg p-4 shadow-lg max-w-sm">
          <p className="text-sm font-medium text-red-800">{errorMessage}</p>
        </div>
      )}

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
            {isLogin ? "Sign in to continue." : "Fill in your details to sign up."}
          </p>
        </div>

        {/* Content */}
        <div className="flex flex-col sm:flex-row items-start justify-center gap-4">
          {/* Mobile mode switch */}
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

            {/* User type selector for mobile */}
            {!isLogin && (
              <div className="mt-4 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-1">
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => switchUserType("user")}
                    className={[
                      "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition",
                      userType === "user" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600",
                    ].join(" ")}
                  >
                    <IconUserPlus className="h-4 w-4" />
                    User
                  </button>

                  <button
                    type="button"
                    onClick={() => switchUserType("restaurant")}
                    className={[
                      "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition",
                      userType === "restaurant" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600",
                    ].join(" ")}
                  >
                    <IconStore className="h-4 w-4" />
                    Restaurant
                  </button>
                </div>
              </div>
            )}
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

            {/* User type selector for desktop (shows when registering) */}
            {!isLogin && (
              <div className="mt-4 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-1">
                <div className="relative rounded-xl bg-slate-100 p-1">
                  {/* active indicator */}
                  <div
                    className={[
                      "absolute left-1 right-1 top-1 h-12 rounded-lg bg-white shadow-sm ring-1 ring-slate-200",
                      "transition-transform duration-300 ease-out",
                      userType === "user" ? "translate-y-0" : "translate-y-12",
                    ].join(" ")}
                  />

                  <div className="relative grid grid-rows-2">
                    {/* USER icon button */}
                    <button
                      type="button"
                      onClick={() => switchUserType("user")}
                      className={[
                        "group relative h-12 w-12 grid place-items-center rounded-lg transition-colors",
                        userType === "user" ? "text-slate-900" : "text-slate-600 hover:text-slate-900",
                        "focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 hover:cursor-pointer",
                      ].join(" ")}
                      aria-label="Register as User"
                      title="Register as User"
                    >
                      <IconUserPlus className="h-5 w-5" />
                      <span className="sr-only">User</span>

                      <span
                        className={[
                          "pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2",
                          "rounded-lg bg-slate-900 text-white text-xs font-semibold px-2 py-1 shadow",
                          "opacity-0 translate-x-1 transition-all duration-150",
                          "group-hover:opacity-100 group-hover:translate-x-0",
                          "group-focus-visible:opacity-100 group-focus-visible:translate-x-0",
                        ].join(" ")}
                      >
                        User
                      </span>
                    </button>

                    {/* RESTAURANT icon button */}
                    <button
                      type="button"
                      onClick={() => switchUserType("restaurant")}
                      className={[
                        "group relative h-12 w-12 grid place-items-center rounded-lg transition-colors",
                        userType === "restaurant" ? "text-slate-900" : "text-slate-600 hover:text-slate-900",
                        "focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 hover:cursor-pointer",
                      ].join(" ")}
                      aria-label="Register as Restaurant"
                      title="Register as Restaurant"
                    >
                      <IconStore className="h-5 w-5" />
                      <span className="sr-only">Restaurant</span>

                      <span
                        className={[
                          "pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2",
                          "rounded-lg bg-slate-900 text-white text-xs font-semibold px-2 py-1 shadow",
                          "opacity-0 translate-x-1 transition-all duration-150",
                          "group-hover:opacity-100 group-hover:translate-x-0",
                          "group-focus-visible:opacity-100 group-focus-visible:translate-x-0",
                        ].join(" ")}
                      >
                        Restaurant
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}
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

                    {/* User type selector for login */}
                    <div className="flex gap-2 p-1 bg-slate-100 rounded-lg">
                      <button
                        type="button"
                        onClick={() => switchUserType("user")}
                        className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md transition ${
                          userType === "user"
                            ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        User
                      </button>
                      <button
                        type="button"
                        onClick={() => switchUserType("restaurant")}
                        className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md transition ${
                          userType === "restaurant"
                            ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        Restaurant
                      </button>
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
                      <h2 className="text-xl font-bold text-slate-900">
                        {isRestaurant ? "Register Restaurant" : "Create account"}
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        Fill in your details to sign up.
                      </p>
                    </div>

                    {isRestaurant ? (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-slate-700">
                            Restaurant Name
                          </label>
                          <input
                            type="text"
                            value={form.restaurantName}
                            onChange={(e) => setForm((f) => ({ ...f, restaurantName: e.target.value }))}
                            placeholder="e.g. Warung Makan"
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-slate-200"
                            required
                          />
                        </div>
                      </>
                    ) : (
                      <>
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
                      </>
                    )}

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

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 hover:cursor-pointer focus:outline-none focus:ring-4 focus:ring-slate-200 disabled:opacity-50"
                    >
                      {submitting ? "Please wait..." : `${isRestaurant ? "Register Restaurant" : "Create account"}`}
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