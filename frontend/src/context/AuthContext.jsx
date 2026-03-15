import { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

function initializeUserFromStorage() {
  try {
    const token = localStorage.getItem('token');
    const saved = localStorage.getItem('user');
    if (token && saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to parse user from storage:', e);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }
  return null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => initializeUserFromStorage());

  const accountUrl = "http://localhost:3001";

  // Register a new user account
  const register = async ({ username, email, password }) => {
    const res = await fetch(`${accountUrl}/account/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    return data;
  };

  // Register a new restaurant account
  const restaurantRegister = async ({ restaurantName, email, password }) => {
    const res = await fetch(`${accountUrl}/account/restaurant/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantName, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    return data;
  };

  // Login to an existing user account
  const login = async ({ email, password }) => {
    const res = await fetch(`${accountUrl}/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    saveSession(data);
  };

  // Login to an existing restaurant account
  const restaurantLogin = async ({ email, password }) => {
    const res = await fetch(`${accountUrl}/account/restaurant/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    saveSession(data);
  };

  // Save token and user to state and localStorage
  const saveSession = ({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    setUser(user);
  };

  // Logout and clear all session data
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, register, restaurantRegister, login, restaurantLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
