import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const OUTSYSTEMS_BASE = 'https://personal-s6eufuop.outsystemscloud.com/FoodRescue_Inventory/rest/InventoryAPI';

function toImageSrc(value) {
  if (!value) return null;

  let raw = String(value).trim();

  try {
    raw = decodeURIComponent(raw);
  } catch {}

  // if already full URL → use directly
  if (raw.startsWith("http")) return raw;

  const bucket = import.meta.env.VITE_S3_BUCKET;
  const region = import.meta.env.VITE_AWS_REGION;

  if (!bucket || !region) {
    console.warn("Missing S3 env config");
    return null;
  }

  const key = raw.startsWith("foods/") ? raw : `foods/${raw}`;

  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}
function ListingCard({ item }) {
   const imageSrc = toImageSrc(item.imageURL);
  const expiryDate = new Date(item.expiryTime);
  const now = new Date();
  const isExpiringSoon = expiryDate - now < 24 * 60 * 60 * 1000;
  const discount = item.originalPrice > 0
    ? Math.round((1 - item.price / item.originalPrice) * 100)
    : 0;
    console.log("🧪 item.imageURL:", item.imageURL);
    console.log("🧪 imageSrc:", imageSrc);
  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 overflow-hidden flex flex-col">
    {imageSrc ? (
      <img
        src={imageSrc}
        alt={item.itemName}
        className="h-40 w-full object-cover"
      />
    ) : (
      <div className="h-40 w-full bg-slate-100 flex items-center justify-center text-slate-400 text-sm">
        No image
      </div>
    )}

      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-900 leading-tight">{item.itemName}</h3>
          {item.cuisineType && (
            <span className="text-xs bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 whitespace-nowrap">
              {item.cuisineType}
            </span>
          )}
        </div>

        {item.description && (
          <p className="text-sm text-slate-500 line-clamp-2">{item.description}</p>
        )}

        <div className="flex items-center gap-2 mt-auto pt-2">
          <span className="text-lg font-bold text-slate-900">${item.price.toFixed(2)}</span>
          {discount > 0 && (
            <>
              <span className="text-sm text-slate-400 line-through">${item.originalPrice.toFixed(2)}</span>
              <span className="text-xs font-semibold text-green-600 bg-green-50 rounded-full px-2 py-0.5">-{discount}%</span>
            </>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Qty: {item.quantity}</span>
          <span className={isExpiringSoon ? 'text-red-500 font-semibold' : ''}>
            Expires {expiryDate.toLocaleDateString()}
          </span>
        </div>

        {(item.restaurantName || item.restaurantId) && (
          <p className="text-xs text-slate-500 truncate">
            🍽 {item.restaurantName || item.restaurantId}
          </p>
        )}
      </div>
    </div>
  );
}

function HomePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [activeListings, setActiveListings] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchType, setSearchType] = useState('restaurantName');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingActive, setLoadingActive] = useState(true);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [errorActive, setErrorActive] = useState(null);
  const [errorSearch, setErrorSearch] = useState(null);
  const [searched, setSearched] = useState(false);

  // Fetch all active food listings on page load
  useEffect(() => {
    fetch(`${OUTSYSTEMS_BASE}/GetActiveListing`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load active listings');
        return r.json();
      })
      .then(setActiveListings)
      .catch((e) => setErrorActive(e.message))
      .finally(() => setLoadingActive(false));
  }, []);

  // Search for listings by restaurant name or item name
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setLoadingSearch(true);
    setErrorSearch(null);
    setSearchResults([]);
    setSearched(true);
    try {
      const q = encodeURIComponent(searchQuery.trim());
      const url = searchType === 'itemName'
        ? `${OUTSYSTEMS_BASE}/GetListingByItemName?itemName=${q}`
        : `${OUTSYSTEMS_BASE}/GetListingByRestaurantName?restaurantName=${q}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('Failed to load search results');
      const data = await r.json();
      setSearchResults(data);
    } catch (e) {
      setErrorSearch(e.message);
    } finally {
      setLoadingSearch(false);
    }
  };

  // Logout and redirect to login page
  const handleLogout = () => {
    logout();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top nav */}
      <header className="bg-white shadow-sm ring-1 ring-slate-200 px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold text-slate-900">FoodRescue</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-600">Hi, <strong>{user?.username}</strong></span>
          <button
            onClick={handleLogout}
            className="text-sm px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-10">

        {/* Active Listings */}
        <section>
          <h2 className="text-xl font-bold text-slate-900 mb-4">Active Listings</h2>

          {loadingActive && (
            <p className="text-slate-500 text-sm">Loading listings...</p>
          )}
          {errorActive && (
            <p className="text-red-500 text-sm">{errorActive}</p>
          )}
          {!loadingActive && !errorActive && activeListings.length === 0 && (
            <p className="text-slate-400 text-sm">No active listings found.</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {activeListings.map((item) => (
              <ListingCard key={item.Id} item={item} />
            ))}
          </div>
        </section>

        {/* Search */}
        <section>
          <h2 className="text-xl font-bold text-slate-900 mb-4">Search Listings</h2>

          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 max-w-xl mb-6">
            {/* Search type toggle */}
            <div className="flex rounded-xl ring-1 ring-slate-200 overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => { setSearchType('restaurantName'); setSearchResults([]); setSearched(false); }}
                className={`px-3 py-2.5 text-sm font-semibold transition ${
                  searchType === 'restaurantName' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                Restaurant
              </button>
              <button
                type="button"
                onClick={() => { setSearchType('itemName'); setSearchResults([]); setSearched(false); }}
                className={`px-3 py-2.5 text-sm font-semibold transition ${
                  searchType === 'itemName' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                Item
              </button>
            </div>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={searchType === 'itemName' ? 'e.g. Sushi' : 'e.g. Warung Makan'}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-slate-200 text-sm"
            />
            <button
              type="submit"
              disabled={loadingSearch}
              className="rounded-xl bg-slate-900 text-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-800 transition disabled:opacity-50"
            >
              {loadingSearch ? 'Searching...' : 'Search'}
            </button>
          </form>

          {errorSearch && (
            <p className="text-red-500 text-sm mb-4">{errorSearch}</p>
          )}
          {!loadingSearch && searched && searchResults.length === 0 && !errorSearch && (
            <p className="text-slate-400 text-sm">No listings found.</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {searchResults.map((item) => (
              <ListingCard key={item.Id} item={item} />
            ))}
          </div>
        </section>

      </main>
    </div>
  );
}

export default HomePage;
