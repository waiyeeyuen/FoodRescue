import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function AuthPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [authMode, setAuthMode] = useState('login'); // Toggle between login and register
  const [form, setForm] = useState({ email: '', password: '', restaurantName: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Handle login or register form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true); // Disable button while request is in flight
    setError(null); // Clear previous errors
    try {
      if (authMode === 'login') {
        await login({ email: form.email, password: form.password });
      } else {
        await register(form);
      }
      navigate('/'); // Redirect to home on success
    } catch (err) {
      setError(err.message); // Show error message to user
    } finally {
      setSubmitting(false); // Re-enable button after submission
    }
  };

  // Switch between login and register modes
  const switchMode = (mode) => {
    setAuthMode(mode);
    setError(null); // Clear errors when switching mode
    setForm({ email: '', password: '', restaurantName: '' });
  };

  return (
    <div className='flex flex-col items-center justify-center min-h-screen gap-6 p-6'>
      <h1 className='text-3xl font-bold'>FoodRescue</h1>

      <div className='flex gap-4'>
        <button
          onClick={() => switchMode('login')}
          className={`px-4 py-2 rounded ${authMode === 'login' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
        >Login</button>
        <button
          onClick={() => switchMode('register')}
          className={`px-4 py-2 rounded ${authMode === 'register' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
        >Register</button>
      </div>

      <form onSubmit={handleSubmit} className='flex flex-col gap-3 w-full max-w-sm'>
        {authMode === 'register' && (
          <input
            value={form.restaurantName}
            onChange={(e) => setForm({ ...form, restaurantName: e.target.value })}
            placeholder='Restaurant Name'
            required
            className='border p-2 rounded'
          />
        )}
        <input
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder='Email'
          type='email'
          required
          className='border p-2 rounded'
        />
        <input
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder='Password'
          type='password'
          required
          className='border p-2 rounded'
        />
        {error && <p className='text-red-500 text-sm'>{error}</p>}
        <button
          type='submit'
          disabled={submitting}
          className='bg-blue-500 text-white p-2 rounded hover:bg-blue-600 disabled:opacity-50'
        >
          {submitting ? 'Please wait...' : authMode === 'login' ? 'Login' : 'Register'}
        </button>
      </form>
    </div>
  );
}

export default AuthPage;
