import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [restaurant, setRestaurant] = useState(null);
  const [loading, setLoading] = useState(true); // Prevent rendering before session is restored

  const accountUrl = "http://localhost:3001";

  // Restore session from localStorage on page load
  useEffect(() => {
    const token = localStorage.getItem('token');
    const saved = localStorage.getItem('restaurant');
    if (token && saved) {
      setRestaurant(JSON.parse(saved)); // Rehydrate restaurant state from storage
    }
    setLoading(false);
  }, []);

  // Register a new restaurant account
  const register = async ({ email, password, restaurantName }) => {
    const res = await fetch(`${accountUrl}/account/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, restaurantName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    saveSession(data); // Store token and restaurant info immediately after registration
  };

  // Login to an existing restaurant account
  const login = async ({ email, password }) => {
    const res = await fetch(`${accountUrl}/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    saveSession(data); // Store token and restaurant info
  };

  // Save token and restaurant to state and localStorage for session persistence
  const saveSession = ({ token, restaurant }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('restaurant', JSON.stringify(restaurant));
    setRestaurant(restaurant);
  };

  // Logout and clear all session data
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('restaurant');
    setRestaurant(null);
  };

  return (
    <AuthContext.Provider value={{ restaurant, loading, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// Custom hook for easy access to auth context
export function useAuth() {
  return useContext(AuthContext);
}
