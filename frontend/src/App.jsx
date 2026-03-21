import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

import UserLayout from './layouts/UserLayout';
import RestaurantLayout from './layouts/RestaurantLayout';

import AuthPage from './pages/AuthPage';

import UserHome from './pages/user/Home';
import UserMap from './pages/user/Map';
import UserOrders from './pages/user/Orders';
import UserFavorites from './pages/user/Favorites';
import UserProfile from './pages/user/Profile';
import UserCart from './pages/user/Cart';
import PaymentSuccessPage from './pages/user/PaymentSuccess';

import RestaurantListings from './pages/restaurant/Listings';
import RestaurantOrders from './pages/restaurant/Orders';
import RestaurantPayouts from './pages/restaurant/Payouts';
import RestaurantProfile from './pages/restaurant/Profile';
import RestaurantSettings from './pages/restaurant/Settings';

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to='/login' replace />;
  return children;
}

function App() {
  const { user } = useAuth();
  const location = useLocation();

  const isRestaurant = user?.restaurantName ? true : false;

  if (user && location.pathname === '/') {
    if (isRestaurant) {
      return <Navigate to='/restaurant' replace />;
    }
  }

  return (
    <Routes>
      <Route path='/login' element={<AuthPage />} />
      <Route path='/auth' element={<Navigate to='/login' replace />} />

      <Route
        path='/'
        element={
          <ProtectedRoute>
            <UserLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<UserHome />} />
        <Route path='map' element={<UserMap />} />
        <Route path='search' element={<Navigate to='/' replace />} />
        <Route path='orders' element={<UserOrders />} />
        <Route path='favorites' element={<UserFavorites />} />
        <Route path='cart' element={<UserCart />} />
        <Route path='profile' element={<UserProfile />} />
        <Route path='payment-success' element={<PaymentSuccessPage />} /> {/* ✅ new */}
      </Route>

      <Route
        path='/restaurant'
        element={
          <ProtectedRoute>
            <RestaurantLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to='listings' replace />} />
        <Route path='listings' element={<RestaurantListings />} />
        <Route path='orders' element={<RestaurantOrders />} />
        <Route path='payouts' element={<RestaurantPayouts />} />
        <Route path='profile' element={<RestaurantProfile />} />
        <Route path='settings' element={<RestaurantSettings />} />
      </Route>

      <Route path='*' element={<Navigate to='/login' replace />} />
    </Routes>
  );
}

export default App;
