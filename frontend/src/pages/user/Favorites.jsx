import { HeartIcon, SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

function getField(item, ...keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null) return item[key];
  }
  return undefined;
}

function FavoriteCard({ item, onRemove }) {
  const itemName = getField(item, 'itemName', 'ItemName', 'name', 'Name') ?? 'Untitled';
  const description = getField(item, 'description', 'Description');
  const cuisineType = getField(item, 'cuisineType', 'CuisineType');
  const imageURL = getField(item, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl');
  const restaurantName = getField(item, 'restaurantName', 'RestaurantName');
  const restaurantId = getField(item, 'restaurantId', 'RestaurantId');
  const quantity = Number(getField(item, 'quantity', 'Quantity') ?? 0);

  const price = Number(getField(item, 'price', 'Price') ?? 0);
  const originalPrice = Number(getField(item, 'originalPrice', 'OriginalPrice') ?? 0);
  const discount = originalPrice > 0 ? Math.round((1 - price / originalPrice) * 100) : 0;

  const expiryTimeRaw = getField(item, 'expiryTime', 'ExpiryTime');
  const expiryDate = expiryTimeRaw ? new Date(expiryTimeRaw) : null;
  const hasValidExpiry = expiryDate && !Number.isNaN(expiryDate.getTime());

  return (
    <div className="rounded-2xl bg-card text-card-foreground shadow-sm ring-1 ring-border overflow-hidden flex flex-col h-full">
      <div className="relative">
        <img
          src={imageURL || '/logo.png'}
          alt={itemName}
          className={`h-40 w-full ${imageURL ? 'object-cover' : 'object-contain p-8 bg-muted'}`}
          loading="lazy"
        />

        {imageURL && (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-black/0 to-black/0" />
        )}

        {discount > 0 && (
          <div className="absolute top-3 left-3 rounded-full bg-foreground/90 text-background px-2 py-1 text-xs font-semibold">
            -{discount}%
          </div>
        )}

        <button
          type="button"
          onClick={() => onRemove(item)}
          className="absolute top-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-md ring-1 ring-black/5 transition hover:scale-105 hover:bg-white"
          aria-label="Remove from favorites"
        >
          <HeartIcon className="size-4 fill-red-500 text-red-500" />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-tight line-clamp-2">{itemName}</h3>
          {cuisineType && (
            <span className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5 whitespace-nowrap">
              {cuisineType}
            </span>
          )}
        </div>

        {description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{description}</p>
        )}

        <div className="flex items-center gap-2 mt-auto pt-2">
          <span className="text-lg font-bold">
            ${Number.isFinite(price) ? price.toFixed(2) : '0.00'}
          </span>
          {discount > 0 && Number.isFinite(originalPrice) && (
            <span className="text-sm text-muted-foreground line-through">
              ${originalPrice.toFixed(2)}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Qty: {Number.isFinite(quantity) ? quantity : 0}</span>
          {hasValidExpiry ? (
            <span>Expires {expiryDate.toLocaleDateString()}</span>
          ) : (
            <span />
          )}
        </div>

        {(restaurantName || restaurantId) && (
          <p className="text-xs text-muted-foreground truncate">{restaurantName ?? restaurantId}</p>
        )}
      </div>
    </div>
  );
}

export default function UserFavorites() {
  const { favorites, toggleFavorite, clearFavorites } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');

  const visibleFavorites = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return favorites;

    return favorites.filter((item) => {
      const haystack = [
        getField(item, 'itemName', 'ItemName', 'name', 'Name'),
        getField(item, 'restaurantName', 'RestaurantName'),
        getField(item, 'cuisineType', 'CuisineType'),
        getField(item, 'description', 'Description'),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [favorites, searchQuery]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Favorites</h1>
        <p className="text-slate-600 mt-2">Your saved food listings</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-xl w-full">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search favorites..."
            className="w-full rounded-xl border border-input bg-background pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-4 focus:ring-ring/20"
          />
        </div>

        {favorites.length > 0 && (
          <Button type="button" variant="outline" onClick={clearFavorites}>
            Clear all
          </Button>
        )}
      </div>

      <div>
        <p className="text-sm text-muted-foreground">
          {visibleFavorites.length} favorite{visibleFavorites.length !== 1 ? 's' : ''}
        </p>
      </div>

      {favorites.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <HeartIcon className="size-5 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">No favorites yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Tap the heart on any listing to save it here.
          </p>
        </div>
      ) : visibleFavorites.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
          <h2 className="text-lg font-semibold text-foreground">No matches found</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Try a different search term.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {visibleFavorites.map((item, idx) => {
            const key =
              getField(item, 'Id', 'id', 'listingId', 'ListingId') ?? `favorite-${idx}`;

            return (
              <FavoriteCard
                key={key}
                item={item}
                onRemove={toggleFavorite}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}