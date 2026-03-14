import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AuthPage from './pages/AuthPage';
import HomePage from './pages/HomePage';
import InventoryPage from './pages/InventoryPage';

// Redirect unauthenticated users to the login page
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null; // Wait for session to be restored before rendering
  return user ? children : <Navigate to='/auth' replace />;
}

function App() {
  return (
    <Routes>
      <Route path='/auth' element={<AuthPage />} />
      <Route path='/' element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      <Route path='/inventory' element={<ProtectedRoute><InventoryPage /></ProtectedRoute>} />
      <Route path='*' element={<Navigate to='/' replace />} />
    </Routes>
  );
}

export default App;
