import { useEffect, useMemo, useState } from 'react';
import { ChevronLeftIcon, HeartIcon, MinusIcon, PlusIcon, SearchIcon, SparklesIcon, XIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

function getField(item, ...keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null) return item[key];
  }
  return undefined;
}

function ListingCard({ item, aiRecommended = false, aiReason = null }) {
  const itemName = getField(item, 'itemName', 'ItemName', 'name', 'Name') ?? 'Untitled';
  const description = getField(item, 'description', 'Description');
  const cuisineType = getField(item, 'cuisineType', 'CuisineType');
  const imageURL = toImageSrc(getField(item, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl'));
  const restaurantName = getField(item, 'restaurantName', 'RestaurantName');
  const restaurantId = getField(item, 'restaurantId', 'RestaurantId');
  const quantity = Number(getField(item, 'quantity', 'Quantity') ?? 0);

  const price = Number(getField(item, 'price', 'Price') ?? 0);
  const originalPrice = Number(getField(item, 'originalPrice', 'OriginalPrice') ?? 0);
  const discount = originalPrice > 0 ? Math.round((1 - price / originalPrice) * 100) : 0;

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
        {aiRecommended && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  className="absolute top-3 right-3 flex items-center gap-1 bg-violet-600 hover:bg-violet-700 text-white text-[11px] px-2 py-0.5 rounded-full shadow-md cursor-default"
                  onClick={(e) => e.stopPropagation()}
                >
                  <SparklesIcon className="size-3" />
                  AI Pick
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[180px] text-center">
                ✨ {aiReason || "Recommended for you"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
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
  const recommendationServiceUrl =
    import.meta.env.VITE_RECOMMENDATION_SERVICE_URL || 'http://localhost:4000';

  const navigate = useNavigate();
  const { user, addToCart } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeListings, setActiveListings] = useState([]);
  const [geminiReasoning, setGeminiReasoning] = useState('');
  const [geminiUsed, setGeminiUsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [orderQty, setOrderQty] = useState(0);
  const [pickupTime, setPickupTime] = useState('');
  const [addConfirmOpen, setAddConfirmOpen] = useState(false);
  const [addConfirmMessage, setAddConfirmMessage] = useState('');
  const [addCartError, setAddCartError] = useState(null);

  useEffect(() => {
    let activeController = null;
    let intervalId = null;

    const loadActiveListings = async ({ showLoading = false } = {}) => {
      const controller = new AbortController();
      activeController = controller;

      try {
        if (showLoading) setLoading(true);
        setError(null);

        let listings = [];

        if (user?.id) {
          const res = await fetch(
            `${recommendationServiceUrl}/recommendations/${encodeURIComponent(user.id)}`,
            { signal: controller.signal }
          );
          if (!res.ok) {
            let message = 'Failed to load recommendations';
            try {
              const body = await res.json();
              message = body?.error || message;
            } catch { /* ignore */ }
            throw new Error(message);
          }
          const data = await res.json();
          const recommended = Array.isArray(data.recommendedListings) ? data.recommendedListings : [];
          const fallback = Array.isArray(data.fallbackListings) ? data.fallbackListings : [];

          setGeminiUsed(data.gemini?.used ?? false);
          setGeminiReasoning(data.gemini?.reasoning ?? '');

          const seen = new Set();
          for (const item of [...recommended, ...fallback]) {
            const id = getField(item, 'Id', 'id', 'listingId', 'ListingId');
            const key = id !== undefined && id !== null ? String(id) : null;
            if (key === null || !seen.has(key)) {
              if (key !== null) seen.add(key);
              listings.push(item);
            }
          }
        } else {
          const res = await fetch(`${inventoryServiceUrl}/inventory/active`, {
            signal: controller.signal,
          });
          if (!res.ok) {
            let message = 'Failed to load active listings';
            try {
              const body = await res.json();
              message = body?.error || message;
            } catch { /* ignore */ }
            throw new Error(message);
          }
          const data = await res.json();
          listings = Array.isArray(data) ? data : [];
        }

        setActiveListings(listings);
      } catch (e) {
        if (e?.name === 'AbortError') return;
        setError(e?.message || 'Failed to load active listings');
      } finally {
        if (showLoading) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [inventoryServiceUrl, recommendationServiceUrl, user?.id]);

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

  useEffect(() => {
    setOrderQty(0);
    setPickupTime('');
    setAddCartError(null);
  }, [selectedItem]);

  const handleAddToCart = async () => {
    if (!selectedItem || !selected) return;
    setAddCartError(null);
    try {
      await addToCart({ item: selectedItem, quantity: orderQty, pickupTime });
      setDetailsOpen(false);
      setAddConfirmMessage(`${orderQty} × ${selected.itemName} added to cart`);
      setAddConfirmOpen(true);
    } catch (e) {
      setAddCartError(e?.message || 'Failed to add to cart');
    }
  };

  const selected = useMemo(() => {
    if (!selectedItem) return null;
    const itemName = getField(selectedItem, 'itemName', 'ItemName', 'name', 'Name') ?? 'Untitled';
    const description = getField(selectedItem, 'description', 'Description');
    const cuisineType = getField(selectedItem, 'cuisineType', 'CuisineType');
    const imageURL = getField(selectedItem, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl');
    const restaurantName = getField(selectedItem, 'restaurantName', 'RestaurantName');
    const restaurantId = getField(selectedItem, 'restaurantId', 'RestaurantId');
    const quantity = Number(getField(selectedItem, 'quantity', 'Quantity') ?? 0);
    const price = Number(getField(selectedItem, 'price', 'Price') ?? 0);
    const originalPrice = Number(getField(selectedItem, 'originalPrice', 'OriginalPrice') ?? 0);
    const discount = originalPrice > 0 ? Math.round((1 - price / originalPrice) * 100) : 0;
    const expiryTimeRaw = getField(selectedItem, 'expiryTime', 'ExpiryTime');
    const expiryDate = expiryTimeRaw ? new Date(expiryTimeRaw) : null;

    return {
      itemName, description, cuisineType, imageURL, restaurantName, restaurantId,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      price: Number.isFinite(price) ? price : 0,
      originalPrice: Number.isFinite(originalPrice) ? originalPrice : null,
      discount,
      expiryDate: expiryDate && !Number.isNaN(expiryDate.getTime()) ? expiryDate : null,
      aiRecommended: selectedItem?.aiRecommended ?? false,
      aiReason: selectedItem?.aiReason ?? null,
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
            const aiRecommended = item?.aiRecommended ?? false;
            const aiReason = item?.aiReason ?? null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleCardClick(item)}
                className="text-left rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30 hover:-translate-y-0.5 transition-transform"
                aria-label="Open listing details"
              >
                <div className="group">
                  <ListingCard item={item} aiRecommended={aiRecommended} aiReason={aiReason} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="sm:max-w-[420px] p-0 overflow-hidden rounded-3xl">
          {selected ? (
            <div className="bg-background">
              <div className="flex items-center justify-between px-4 pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setDetailsOpen(false)}
                  aria-label="Back"
                >
                  <ChevronLeftIcon className="size-4" />
                </Button>
                <p className="text-sm font-semibold text-foreground truncate max-w-[240px]">
                  {selected.restaurantName ?? selected.restaurantId ?? 'Restaurant'}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Favorite"
                  disabled
                  title="Favorites coming soon"
                >
                  <HeartIcon className="size-4" />
                </Button>
              </div>

              <div className="px-6 pt-4">
                <div className="mx-auto size-44 sm:size-52 rounded-3xl bg-muted/40 ring-1 ring-border flex items-center justify-center overflow-hidden relative">
                  <img
                    src={selected.imageURL || "/logo.png"}
                    alt={selected.itemName}
                    className={selected.imageURL ? "h-full w-full object-cover" : "h-full w-full object-contain p-8"}
                    loading="lazy"
                  />
                  {selected.aiRecommended && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge className="absolute top-2 right-2 flex items-center gap-1 bg-violet-600 hover:bg-violet-700 text-white text-[11px] px-2 py-0.5 rounded-full shadow-md cursor-default">
                            <SparklesIcon className="size-3" />
                            AI Pick
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[180px] text-center">
                          ✨ {selected.aiReason || "Recommended for you"}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>

              <div className="px-6 pt-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-xl font-semibold leading-tight">{selected.itemName}</h2>
                  {selected.cuisineType ? (
                    <span className="mt-0.5 inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground whitespace-nowrap">
                      {selected.cuisineType}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="px-6 pt-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {selected.description || 'No description provided.'}
                </p>
              </div>

              <div className="px-6 pt-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-2xl bg-muted/30 ring-1 ring-border px-3 py-3">
                    <p className="text-sm font-semibold text-foreground">${selected.price.toFixed(2)}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Price</p>
                  </div>
                  <div className="rounded-2xl bg-muted/30 ring-1 ring-border px-3 py-3">
                    <p className="text-sm font-semibold text-foreground">{selected.quantity}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Quantity</p>
                  </div>
                  <div className="rounded-2xl bg-muted/30 ring-1 ring-border px-3 py-3">
                    {selected.expiryDate ? (
                      <>
                        <p className="text-sm font-semibold text-foreground">
                          {selected.expiryDate.toLocaleDateString()}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {selected.expiryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm font-semibold text-foreground">—</p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">Expiry</p>
                  </div>
                </div>
              </div>

              <div className="px-6 pt-5 pb-24">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Choose quantity</p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        onClick={() => setOrderQty((q) => Math.max(0, q - 1))}
                        disabled={orderQty <= 0}
                        aria-label="Decrease quantity"
                      >
                        <MinusIcon className="size-4" />
                      </Button>
                      <div className="w-10 text-center text-base font-semibold">{orderQty}</div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        onClick={() =>
                          setOrderQty((q) =>
                            selected.quantity > 0 ? Math.min(selected.quantity, q + 1) : q + 1
                          )
                        }
                        disabled={selected.quantity > 0 ? orderQty >= selected.quantity : false}
                        aria-label="Increase quantity"
                      >
                        <PlusIcon className="size-4" />
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {selected.quantity > 0 ? `${selected.quantity} left` : 'In stock'}
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Pickup time</p>
                    <input
                      type="time"
                      value={pickupTime}
                      onChange={(e) => setPickupTime(e.target.value)}
                      className="h-10 w-full rounded-2xl border border-input bg-background px-3 text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">Required to order</p>
                  </div>
                </div>
              </div>

              <div className="absolute inset-x-0 bottom-0 p-4 bg-background/80 supports-backdrop-filter:backdrop-blur border-t border-border">
                {addCartError && (
                  <div className="mb-3 text-xs text-red-600 bg-red-50 ring-1 ring-red-200 rounded-xl px-3 py-2">
                    {addCartError}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    className="flex-1 rounded-2xl h-11"
                    disabled={orderQty < 1 || !pickupTime}
                    title={orderQty < 1 ? 'Select quantity' : !pickupTime ? 'Select pickup time' : undefined}
                    onClick={handleAddToCart}
                  >
                    Add to cart
                  </Button>
                  <div className="text-right">
                    <p className="text-[11px] text-muted-foreground">Total</p>
                    <p className="text-lg font-bold text-foreground">
                      ${(selected.price * Math.max(0, orderQty)).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3 py-10">
              <Spinner />
              <span className="text-sm text-muted-foreground">Loading details...</span>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={addConfirmOpen} onOpenChange={setAddConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Added to cart</DialogTitle>
            <DialogDescription>{addConfirmMessage || 'Item added to cart.'}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAddConfirmOpen(false)}>
              Continue
            </Button>
            <Button type="button" onClick={() => { setAddConfirmOpen(false); navigate('/cart'); }}>
              View cart
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
