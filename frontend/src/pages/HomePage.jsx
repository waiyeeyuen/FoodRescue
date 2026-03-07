import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function HomePage() {
  const { restaurant, logout } = useAuth();
  const navigate = useNavigate();

  // Logout and redirect to login page
  const handleLogout = () => {
    logout();
    navigate('/auth');
  };

  return (
    <div className='flex flex-col gap-6 p-6'>
      <div className='flex justify-between items-center'>
        <h1 className='text-2xl font-bold'>Welcome, {restaurant?.restaurantName}!</h1>
        <button
          onClick={handleLogout}
          className='bg-gray-200 px-3 py-1 rounded text-sm hover:bg-gray-300'
        >Logout</button>
      </div>

      <div className='grid grid-cols-1 gap-4 max-w-md'>
        <button
          onClick={() => navigate('/inventory')}
          className='bg-blue-500 text-white p-4 rounded text-lg font-semibold hover:bg-blue-600'
        >
          Manage Inventory
        </button>
      </div>
    </div>
  );
}

export default HomePage;
