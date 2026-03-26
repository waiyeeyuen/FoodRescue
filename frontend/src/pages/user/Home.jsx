import { useEffect, useMemo, useRef, useState } from 'react';
import {
  HeartIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/context/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

const MAX_RECOMMENDATIONS = 6;

function getField(item, ...keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null) return item[key];
  }
  return undefined;
}

function getListingId(item) {
  const id = getField(item, 'Id', 'id', 'listingId', 'ListingId');
  return id !== undefined && id !== null ? String(id) : null;
}

function getRawQuantity(item) {
  const value = Number(
    getField(
      item,
      'quantity',
      'Quantity',
      'stock',
      'Stock',
      'remainingQuantity',
      'RemainingQuantity'
    ) ?? 0
  );
  return Number.isFinite(value) ? value : 0;
}

function formatLocalDateTimeInput(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function getDefaultPickupDateTime() {
  const nextSlot = new Date();
  nextSlot.setMinutes(nextSlot.getMinutes() + 30);
  nextSlot.setSeconds(0, 0);
  return formatLocalDateTimeInput(nextSlot);
}

function getMinimumPickupDateTime() {
  const now = new Date();
  now.setSeconds(0, 0);
  return formatLocalDateTimeInput(now);
}

function getMaximumPickupDateTime(expiryDate) {
  if (!(expiryDate instanceof Date) || Number.isNaN(expiryDate.getTime())) return undefined;
  return formatLocalDateTimeInput(expiryDate);
}

function toImageSrc(value) {
  if (!value) return null;

  let raw = String(value).trim();

  try {
    raw = decodeURIComponent(raw);
  } catch {}

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

function ListingCard({
  item,
  aiRecommended = false,
  aiReason = null,
  isFavorited = false,
  onToggleFavorite,
}) {
  const itemName = getField(item, 'itemName', 'ItemName', 'name', 'Name') ?? 'Untitled';
  const description = getField(item, 'description', 'Description');
  const cuisineType = getField(item, 'cuisineType', 'CuisineType');
  const imageURL = getField(item, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl');
  const restaurantName = getField(item, 'restaurantName', 'RestaurantName');
  const imageSrc = toImageSrc(imageURL);
  const remainingQuantity = Number(item?.remainingQuantity ?? getRawQuantity(item));
  const price = Number(getField(item, 'price', 'Price') ?? 0);
  const originalPrice = Number(getField(item, 'originalPrice', 'OriginalPrice') ?? 0);
  const discount = originalPrice > 0 ? Math.round((1 - price / originalPrice) * 100) : 0;

  const expiryTimeRaw = getField(item, 'expiryTime', 'ExpiryTime');
  const expiryDate = expiryTimeRaw ? new Date(expiryTimeRaw) : null;
  const isExpiringSoon =
    expiryDate && !Number.isNaN(expiryDate.getTime())
      ? expiryDate.getTime() - Date.now() < 24 * 60 * 60 * 1000
      : false;

  return (
    <div className="h-full overflow-hidden rounded-2xl bg-card text-card-foreground shadow-sm ring-1 ring-border transition will-change-transform group-hover:shadow-md group-hover:ring-foreground/15">
      <div className="relative">
        <img
          src={imageSrc || '/logo.png'}
          alt={itemName}
          className={`h-40 w-full ${imageSrc ? 'object-cover' : 'bg-muted p-8 object-contain'}`}
          loading="lazy"
        />

        {imageSrc && (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-black/0 to-black/0" />
        )}

        {discount > 0 && (
          <div className="absolute left-3 top-3 rounded-full bg-foreground/90 px-2 py-1 text-xs font-semibold text-background">
            -{discount}%
          </div>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite?.(item);
          }}
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-md ring-1 ring-black/5 transition hover:scale-105 hover:bg-white"
          aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
        >
          <HeartIcon
            className={`size-4 ${isFavorited ? 'fill-red-500 text-red-500' : 'text-slate-700'}`}
          />
        </button>

        {aiRecommended && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  className="absolute bottom-3 right-3 cursor-default rounded-full bg-violet-600 px-2 py-0.5 text-[11px] text-white shadow-md hover:bg-violet-700"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="flex items-center gap-1">
                    <SparklesIcon className="size-3" />
                    AI Pick
                  </span>
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[180px] text-center">
                ✨ {aiReason || 'Recommended for you'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 font-semibold leading-tight">{itemName}</h3>
          {cuisineType && (
            <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {cuisineType}
            </span>
          )}
        </div>

        {description && <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p>}

        <div className="mt-auto flex items-center gap-2 pt-2">
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
          <span>Qty: {remainingQuantity}</span>
          {expiryDate && !Number.isNaN(expiryDate.getTime()) ? (
            <span className={isExpiringSoon ? 'font-semibold text-red-500' : ''}>
              Expires {expiryDate.toLocaleDateString()}
            </span>
          ) : (
            <span />
          )}
        </div>

        {restaurantName && <p className="truncate text-xs text-muted-foreground">{restaurantName}</p>}
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
  const {
    user,
    addToCart,
    toggleFavorite,
    isFavorite,
    getRemainingStockForListing,
    canAddToCart,
    getCartQuantityForListing,
  } = useAuth();

  const inputRef = useRef(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeListings, setActiveListings] = useState([]);
  const [recommendedListings, setRecommendedListings] = useState([]);
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
    const controller = new AbortController();

    async function loadListings() {
      try {
        setLoading(true);
        setError(null);

        const inventoryRes = await fetch(`${inventoryServiceUrl}/inventory/active`, {
          signal: controller.signal,
        });

        if (!inventoryRes.ok) {
          let message = 'Failed to load active listings';
          try {
            const body = await inventoryRes.json();
            message = body?.error || message;
          } catch {}
          throw new Error(message);
        }

        const inventoryData = await inventoryRes.json();
        const inventoryListings = Array.isArray(inventoryData?.data)
          ? inventoryData.data
          : Array.isArray(inventoryData)
            ? inventoryData
            : [];

        setActiveListings(inventoryListings);

        if (user?.id) {
          try {
            const recRes = await fetch(
              `${recommendationServiceUrl}/recommendations/${encodeURIComponent(user.id)}`,
              { signal: controller.signal }
            );

            if (!recRes.ok) {
              throw new Error('Failed to load recommendations');
            }

            const recData = await recRes.json();

            const recommended = Array.isArray(recData?.recommendedListings)
              ? recData.recommendedListings
              : [];

            const fallback = Array.isArray(recData?.fallbackListings)
              ? recData.fallbackListings
              : [];

            const merged = [...recommended, ...fallback];
            const seen = new Set();
            const deduped = [];

            for (const item of merged) {
              const id = getListingId(item);
              if (!id || seen.has(id)) continue;
              seen.add(id);
              deduped.push(item);
            }

            setRecommendedListings(deduped);
            setGeminiUsed(Boolean(recData?.gemini?.used));
            setGeminiReasoning(recData?.gemini?.reasoning || '');
          } catch (err) {
            console.error('Failed to load recommendations:', err);
            setRecommendedListings([]);
            setGeminiUsed(false);
            setGeminiReasoning('');
          }
        } else {
          setRecommendedListings([]);
          setGeminiUsed(false);
          setGeminiReasoning('');
        }
      } catch (e) {
        if (e?.name === 'AbortError') return;
        setError(e?.message || 'Failed to load homepage');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadListings();

    const handleFocus = () => loadListings();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') loadListings();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      controller.abort();
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [inventoryServiceUrl, recommendationServiceUrl, user?.id]);

  const stockAdjustedListings = useMemo(() => {
    return activeListings
      .map((item) => ({
        ...item,
        remainingQuantity: Math.max(0, getRemainingStockForListing(item)),
      }))
      .filter((item) => Number(item?.remainingQuantity ?? 0) > 0);
  }, [activeListings, getRemainingStockForListing]);

  const stockAdjustedRecommendedListings = useMemo(() => {
    return recommendedListings
      .map((item, index) => ({
        ...item,
        aiRecommended: true,
        aiReason: item?.aiReason ?? item?.reason ?? null,
        remainingQuantity: Math.max(0, getRemainingStockForListing(item)),
        __recommendedIndex: index,
      }))
      .filter((item) => Number(item?.remainingQuantity ?? 0) > 0)
      .slice(0, MAX_RECOMMENDATIONS);
  }, [recommendedListings, getRemainingStockForListing]);

  const visibleListings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return stockAdjustedListings;

    return stockAdjustedListings.filter((item) => {
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
  }, [stockAdjustedListings, searchQuery]);

  const visibleRecommendedListings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return stockAdjustedRecommendedListings;

    return stockAdjustedRecommendedListings.filter((item) => {
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
  }, [stockAdjustedRecommendedListings, searchQuery]);

  const recommendedIdSet = useMemo(
    () => new Set(visibleRecommendedListings.map((item) => getListingId(item)).filter(Boolean)),
    [visibleRecommendedListings]
  );

  const regularListings = useMemo(
    () => visibleListings.filter((item) => !recommendedIdSet.has(getListingId(item))),
    [visibleListings, recommendedIdSet]
  );

  const handleCardClick = (item) => {
    setSelectedItem(item);
    setDetailsOpen(true);
  };

  useEffect(() => {
    setOrderQty(0);
    setPickupTime(getDefaultPickupDateTime());
    setAddCartError(null);
  }, [selectedItem]);

  const selected = useMemo(() => {
    if (!selectedItem) return null;

    const remainingQuantity = getRemainingStockForListing(selectedItem);
    const alreadyInCart = getCartQuantityForListing(selectedItem);

    const itemName = getField(selectedItem, 'itemName', 'ItemName', 'name', 'Name') ?? 'Untitled';
    const description = getField(selectedItem, 'description', 'Description');
    const cuisineType = getField(selectedItem, 'cuisineType', 'CuisineType');
    const imageURL = getField(selectedItem, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl');
    const restaurantName = getField(selectedItem, 'restaurantName', 'RestaurantName');
    const price = Number(getField(selectedItem, 'price', 'Price') ?? 0);
    const originalPrice = Number(getField(selectedItem, 'originalPrice', 'OriginalPrice') ?? 0);
    const discount = originalPrice > 0 ? Math.round((1 - price / originalPrice) * 100) : 0;
    const expiryTimeRaw = getField(selectedItem, 'expiryTime', 'ExpiryTime');
    const expiryDate = expiryTimeRaw ? new Date(expiryTimeRaw) : null;

    return {
      itemName,
      description,
      cuisineType,
      imageURL,
      restaurantName,
      quantity: Math.max(0, remainingQuantity),
      alreadyInCart,
      price: Number.isFinite(price) ? price : 0,
      originalPrice: Number.isFinite(originalPrice) ? originalPrice : null,
      discount,
      expiryDate: expiryDate && !Number.isNaN(expiryDate.getTime()) ? expiryDate : null,
      aiRecommended: selectedItem?.aiRecommended ?? false,
      aiReason: selectedItem?.aiReason ?? selectedItem?.reason ?? null,
    };
  }, [selectedItem, getRemainingStockForListing, getCartQuantityForListing]);

  useEffect(() => {
    if (!selected) return;
    setOrderQty((current) => Math.min(current, selected.quantity));
  }, [selected]);

  const handleAddToCart = async () => {
    if (!selectedItem || !selected) return;

    setAddCartError(null);

    if (orderQty < 1) {
      setAddCartError('Select at least 1 item');
      return;
    }

    if (!pickupTime) {
      setAddCartError('Please select a pickup time');
      return;
    }

    if (!canAddToCart(selectedItem, orderQty)) {
      setAddCartError(
        selected.quantity <= 0
          ? 'This listing is sold out'
          : `You can only add ${selected.quantity} more for this listing`
      );
      return;
    }

    try {
      await addToCart({ item: selectedItem, quantity: orderQty, pickupTime });
      setDetailsOpen(false);
      setAddConfirmMessage(`${orderQty} × ${selected.itemName} added to cart`);
      setAddConfirmOpen(true);
    } catch (e) {
      setAddCartError(e?.message || 'Failed to add to cart');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Homepage</h1>
        <p className="mt-2 text-slate-600">Good food, saved in time.</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="relative max-w-xl overflow-hidden rounded-xl">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />

          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by item, restaurant, cuisine..."
            className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-4 focus:ring-ring/20"
          />

          {searchQuery.trim() !== '' && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                requestAnimationFrame(() => {
                  inputRef.current?.focus();
                });
              }}
              className="absolute right-2 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Clear search"
            >
              <XIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16">
          <Spinner className="size-6" />
          <span className="text-sm text-muted-foreground">Loading listings...</span>
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : stockAdjustedListings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active listings found.</p>
      ) : visibleListings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matches for your search.</p>
      ) : (
        <div className="flex flex-col gap-8">
          {visibleRecommendedListings.length > 0 && (
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
                  <SparklesIcon className="size-5 text-violet-600" />
                  Recommended for you
                </h2>
                <p className="text-sm text-muted-foreground">
                  Personalized picks powered by Gemini
                </p>
              </div>

              <div className="overflow-x-auto pb-2">
                <div className="flex min-w-max gap-4">
                  {visibleRecommendedListings.map((item, idx) => {
                    const key = getListingId(item) ?? `rec-${idx}`;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleCardClick(item)}
                        className="w-[280px] shrink-0 rounded-2xl text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30 sm:w-[300px]"
                      >
                        <div className="group h-full">
                          <ListingCard
                            item={item}
                            aiRecommended={true}
                            aiReason={item?.aiReason ?? null}
                            isFavorited={isFavorite(item)}
                            onToggleFavorite={toggleFavorite}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">All listings</h2>
              <p className="text-sm text-muted-foreground">Browse all available food listings</p>
            </div>

            {regularListings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No general listings match your search.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {regularListings.map((item, idx) => {
                  const key = getListingId(item) ?? `all-${idx}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleCardClick(item)}
                      className="rounded-2xl text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30"
                    >
                      <div className="group">
                        <ListingCard
                          item={item}
                          aiRecommended={Boolean(item?.aiRecommended)}
                          aiReason={item?.aiReason ?? null}
                          isFavorited={isFavorite(item)}
                          onToggleFavorite={toggleFavorite}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-md overflow-hidden rounded-3xl p-0">
          {selected && selectedItem && (
            <div className="flex flex-col">
              <div className="relative">
                <img
                  src={toImageSrc(selected.imageURL) || '/logo.png'}
                  alt={selected.itemName}
                  className={`h-44 w-full ${selected.imageURL ? 'object-cover' : 'bg-muted p-8 object-contain'}`}
                />
              </div>

              <div className="flex flex-col gap-4 p-5">
                <DialogHeader className="space-y-2 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <DialogTitle className="text-xl font-semibold leading-tight">
                        {selected.itemName}
                      </DialogTitle>
                      <DialogDescription className="mt-1 text-sm text-muted-foreground">
                        {selected.restaurantName || 'Fresh surplus food'}
                      </DialogDescription>
                    </div>

                    {selected.aiRecommended && (
                      <Badge className="rounded-full bg-violet-600 text-white hover:bg-violet-700">
                        <SparklesIcon className="mr-1 size-3" /> AI Pick
                      </Badge>
                    )}
                  </div>
                </DialogHeader>

                {selected.description && (
                  <p className="text-sm leading-5 text-muted-foreground line-clamp-3">
                    {selected.description}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Price</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-lg font-bold">${selected.price.toFixed(2)}</span>
                      {selected.discount > 0 && selected.originalPrice !== null && (
                        <span className="text-xs text-muted-foreground line-through">
                          ${selected.originalPrice.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Available now
                    </p>
                    <p className="mt-1 text-lg font-bold">{selected.quantity}</p>
                    {selected.alreadyInCart > 0 && (
                      <p className="mt-1 text-xs text-amber-600">
                        {selected.alreadyInCart} already in cart
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-3">
                  <div>
                    <p className="mb-2 text-sm font-medium text-slate-900">Quantity</p>
                    <div className="inline-flex items-center rounded-2xl border border-input bg-background p-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setOrderQty((qty) => Math.max(0, qty - 1))}
                        disabled={orderQty <= 0}
                      >
                        <MinusIcon />
                      </Button>
                      <span className="min-w-10 text-center text-sm font-medium">{orderQty}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setOrderQty((qty) => Math.min(selected.quantity, qty + 1))}
                        disabled={orderQty >= selected.quantity}
                      >
                        <PlusIcon />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-900">
                      Collection timing
                    </label>
                    <input
                      type="datetime-local"
                      value={pickupTime}
                      onChange={(e) => setPickupTime(e.target.value)}
                      min={getMinimumPickupDateTime()}
                      max={getMaximumPickupDateTime(selected?.expiryDate)}
                      className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-ring/20"
                    />
                  </div>
                </div>

                {addCartError && <p className="text-sm text-red-600">{addCartError}</p>}

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" onClick={() => setDetailsOpen(false)}>
                    Close
                  </Button>
                  <Button type="button" onClick={handleAddToCart} disabled={selected.quantity <= 0}>
                    Add to cart
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
