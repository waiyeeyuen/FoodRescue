import { useEffect, useMemo, useState } from 'react';
import { SearchIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';

function getField(item, ...keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null) return item[key];
  }
  return undefined;
}

function ListingCard({ item }) {
  const itemName = getField(item, 'itemName', 'ItemName', 'name', 'Name') ?? 'Untitled';
  const description = getField(item, 'description', 'Description');
  const cuisineType = getField(item, 'cuisineType', 'CuisineType');
  const imageURL = getField(item, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl');
  const restaurantName = getField(item, 'restaurantName', 'RestaurantName');
  const restaurantId = getField(item, 'restaurantId', 'RestaurantId');
  const quantity = Number(getField(item, 'quantity', 'Quantity') ?? 0);

  const price = Number(getField(item, 'price', 'Price') ?? 0);
  const originalPrice = Number(getField(item, 'originalPrice', 'OriginalPrice') ?? 0);
  const discount =
    originalPrice > 0 ? Math.round((1 - price / originalPrice) * 100) : 0;

  const expiryTimeRaw = getField(item, 'expiryTime', 'ExpiryTime');
  const expiryDate = expiryTimeRaw ? new Date(expiryTimeRaw) : null;
  const isExpiringSoon = useMemo(() => {
    if (!expiryDate || Number.isNaN(expiryDate.getTime())) return false;
    return expiryDate.getTime() - Date.now() < 24 * 60 * 60 * 1000;
  }, [expiryDate]);

  return (
    <div className="rounded-2xl bg-card text-card-foreground shadow-sm ring-1 ring-border overflow-hidden flex flex-col transition will-change-transform group-hover:shadow-md group-hover:ring-foreground/15">
      <div className="relative">
        <img
          src={imageURL || "/logo.png"}
          alt={itemName}
          className={`h-40 w-full ${imageURL ? "object-cover" : "object-contain p-8 bg-muted"}`}
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
      </div>

      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-tight line-clamp-2">
            {itemName}
          </h3>
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
            <>
              <span className="text-sm text-muted-foreground line-through">
                ${originalPrice.toFixed(2)}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Qty: {Number.isFinite(quantity) ? quantity : 0}</span>
          {expiryDate && !Number.isNaN(expiryDate.getTime()) ? (
            <span className={isExpiringSoon ? 'text-red-500 font-semibold' : ''}>
              Expires {expiryDate.toLocaleDateString()}
            </span>
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

export default function UserHome() {
  const inventoryServiceUrl =
    import.meta.env.VITE_INVENTORY_SERVICE_URL || 'http://localhost:3000';

  const [searchQuery, setSearchQuery] = useState('');
  const [activeListings, setActiveListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`${inventoryServiceUrl}/inventory/active`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          let message = 'Failed to load active listings';
          try {
            const body = await res.json();
            message = body?.error || message;
          } catch {
            // ignore
          }
          throw new Error(message);
        }
        const data = await res.json();
        setActiveListings(Array.isArray(data) ? data : []);
      } catch (e) {
        if (e?.name === 'AbortError') return;
        setError(e?.message || 'Failed to load active listings');
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [inventoryServiceUrl]);

  const visibleListings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeListings;
    return activeListings.filter((item) => {
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
  }, [activeListings, searchQuery]);

  const handleCardClick = (item) => {
    setSelectedItem(item);
    setDetailsOpen(true);
  };

  const selected = useMemo(() => {
    if (!selectedItem) return null;
    const itemName =
      getField(selectedItem, 'itemName', 'ItemName', 'name', 'Name') ?? 'Untitled';
    const description = getField(selectedItem, 'description', 'Description');
    const cuisineType = getField(selectedItem, 'cuisineType', 'CuisineType');
    const imageURL = getField(
      selectedItem,
      'imageURL',
      'ImageURL',
      'imageUrl',
      'ImageUrl'
    );
    const restaurantName = getField(selectedItem, 'restaurantName', 'RestaurantName');
    const restaurantId = getField(selectedItem, 'restaurantId', 'RestaurantId');
    const quantity = Number(getField(selectedItem, 'quantity', 'Quantity') ?? 0);
    const price = Number(getField(selectedItem, 'price', 'Price') ?? 0);
    const originalPrice = Number(getField(selectedItem, 'originalPrice', 'OriginalPrice') ?? 0);
    const discount =
      originalPrice > 0 ? Math.round((1 - price / originalPrice) * 100) : 0;
    const expiryTimeRaw = getField(selectedItem, 'expiryTime', 'ExpiryTime');
    const expiryDate = expiryTimeRaw ? new Date(expiryTimeRaw) : null;

    return {
      itemName,
      description,
      cuisineType,
      imageURL,
      restaurantName,
      restaurantId,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      price: Number.isFinite(price) ? price : 0,
      originalPrice: Number.isFinite(originalPrice) ? originalPrice : null,
      discount,
      expiryDate: expiryDate && !Number.isNaN(expiryDate.getTime()) ? expiryDate : null,
    };
  }, [selectedItem]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Home</h1>
        <p className="text-slate-600 mt-2">Save the almost thrown away food</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="relative max-w-xl">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by item, restaurant, cuisine..."
            className="w-full rounded-xl border border-input bg-background pl-9 pr-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-4 focus:ring-ring/20"
          />
          {searchQuery.trim() && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <XIcon />
            </Button>
          )}
        </div>
        {!loading && !error && (
          <p className="text-xs text-muted-foreground">
            Showing {visibleListings.length} of {activeListings.length}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16">
          <Spinner className="size-6" />
          <span className="text-sm text-muted-foreground">Loading listings...</span>
        </div>
      ) : error ? (
        <p className="text-red-600 text-sm">{error}</p>
      ) : activeListings.length === 0 ? (
        <p className="text-muted-foreground text-sm">No active listings found.</p>
      ) : visibleListings.length === 0 ? (
        <p className="text-muted-foreground text-sm">No matches for your search.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {visibleListings.map((item, idx) => {
            const key = getField(item, 'Id', 'id', 'listingId', 'ListingId') ?? idx;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleCardClick(item)}
                className="text-left rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30 hover:-translate-y-0.5 transition-transform"
                aria-label="Open listing details"
              >
                <div className="group">
                  <ListingCard item={item} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
          {selected ? (
            <>
              <div className="relative">
                <img
                  src={selected.imageURL || "/logo.png"}
                  alt={selected.itemName}
                  className={`w-full h-56 sm:h-64 ${selected.imageURL ? "object-cover" : "object-contain p-10 bg-muted"}`}
                />
                {selected.discount > 0 && (
                  <div className="absolute top-4 left-4 rounded-full bg-foreground/90 text-background px-3 py-1 text-xs font-semibold">
                    -{selected.discount}% off
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/55 via-black/0 to-black/0" />
                <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5 text-white">
                  <p className="text-sm/5 opacity-90">
                    {selected.restaurantName ?? selected.restaurantId ?? 'Restaurant'}
                  </p>
                  <h2 className="text-xl sm:text-2xl font-semibold leading-tight">
                    {selected.itemName}
                  </h2>
                </div>
              </div>

              <div className="p-4 sm:p-5 grid gap-5 sm:grid-cols-5">
                <div className="sm:col-span-3 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {selected.cuisineType && (
                      <span className="text-xs bg-muted text-muted-foreground rounded-full px-2.5 py-1">
                        {selected.cuisineType}
                      </span>
                    )}
                    <span className="text-xs bg-muted text-muted-foreground rounded-full px-2.5 py-1">
                      Qty: {selected.quantity}
                    </span>
                    {selected.expiryDate && (
                      <span className="text-xs bg-muted text-muted-foreground rounded-full px-2.5 py-1">
                        Expires {selected.expiryDate.toLocaleString()}
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold">${selected.price.toFixed(2)}</span>
                    {selected.originalPrice !== null && selected.discount > 0 && (
                      <span className="text-sm text-muted-foreground line-through">
                        ${selected.originalPrice.toFixed(2)}
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {selected.description || 'No description provided.'}
                  </p>
                </div>

                <div className="sm:col-span-2">
                  <div className="rounded-2xl bg-muted/30 ring-1 ring-border p-4 flex flex-col gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Restaurant</p>
                      <p className="text-sm font-semibold">
                        {selected.restaurantName ?? selected.restaurantId ?? '—'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-background/70 ring-1 ring-border p-3">
                        <p className="text-xs text-muted-foreground">Price</p>
                        <p className="text-sm font-semibold">${selected.price.toFixed(2)}</p>
                      </div>
                      <div className="rounded-xl bg-background/70 ring-1 ring-border p-3">
                        <p className="text-xs text-muted-foreground">Quantity</p>
                        <p className="text-sm font-semibold">{selected.quantity}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Expiry</p>
                      <p className="text-sm font-semibold">
                        {selected.expiryDate ? selected.expiryDate.toLocaleString() : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center gap-3 py-10">
              <Spinner />
              <span className="text-sm text-muted-foreground">Loading details...</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
