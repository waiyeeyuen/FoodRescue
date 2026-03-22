import { PackageIcon, SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

function getField(item, ...keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null) return item[key];
  }
  return undefined;
}

function OrderCard({ order }) {
  const item = order?.item || {};
  const itemName = getField(item, 'itemName', 'ItemName', 'name', 'Name') ?? 'Untitled';
  const description = getField(item, 'description', 'Description');
  const cuisineType = getField(item, 'cuisineType', 'CuisineType');
  const imageURL = getField(item, 'imageURL', 'ImageURL', 'imageUrl', 'ImageUrl');
  const restaurantName = getField(item, 'restaurantName', 'RestaurantName');
  const restaurantId = getField(item, 'restaurantId', 'RestaurantId');
  const price = Number(getField(item, 'price', 'Price') ?? 0);
  const originalPrice = Number(getField(item, 'originalPrice', 'OriginalPrice') ?? 0);
  const quantity = Number(order?.quantity ?? 1);
  const status = order?.status ?? 'Active';
  const pickupTime = order?.pickupTime ?? '';
  const createdAt = order?.createdAt ? new Date(order.createdAt) : null;

  const discount =
    originalPrice > 0 ? Math.round((1 - price / originalPrice) * 100) : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-sm ring-1 ring-border">
      <div className="relative">
        <img
          src={imageURL || '/logo.png'}
          alt={itemName}
          className={`h-44 w-full ${imageURL ? 'object-cover' : 'object-contain bg-muted p-8'}`}
          loading="lazy"
        />

        {discount > 0 && (
          <div className="absolute left-3 top-3 rounded-full bg-foreground/90 px-2 py-1 text-xs font-semibold text-background">
            -{discount}%
          </div>
        )}

        <div
          className={`absolute right-3 top-3 rounded-full px-2 py-1 text-xs font-semibold ${
            status === 'Active'
              ? 'bg-green-100 text-green-700'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {status}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="line-clamp-2 text-base font-semibold leading-tight">
            {itemName}
          </h3>
          {(restaurantName || restaurantId) && (
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {restaurantName ?? restaurantId}
            </p>
          )}
        </div>

        {description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {description}
          </p>
        )}

        {cuisineType && (
          <div>
            <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              {cuisineType}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">${price.toFixed(2)}</span>
          {discount > 0 && originalPrice > 0 && (
            <span className="text-sm text-muted-foreground line-through">
              ${originalPrice.toFixed(2)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">Quantity</p>
            <p className="font-semibold">{quantity}</p>
          </div>
          <div className="rounded-xl bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="font-semibold">${(price * quantity).toFixed(2)}</p>
          </div>
          <div className="col-span-2 rounded-xl bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">Pickup time</p>
            <p className="font-semibold">{pickupTime || '-'}</p>
          </div>
        </div>

        <div className="mt-auto space-y-1">
          {createdAt && !Number.isNaN(createdAt.getTime()) && (
            <p className="text-xs text-muted-foreground">
              Placed on {createdAt.toLocaleDateString()},{' '}
              {createdAt.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </p>
          )}

          {order?.orderId && (
            <p className="break-all text-xs text-muted-foreground">
              Order ID: {order.orderId}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function UserOrders() {
  const { orders, clearOrders } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');

  const sortedOrders = useMemo(() => {
    return [...orders].sort((a, b) => {
      const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [orders]);

  const visibleOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedOrders;

    return sortedOrders.filter((order) => {
      const item = order?.item || {};
      const haystack = [
        getField(item, 'itemName', 'ItemName', 'name', 'Name'),
        getField(item, 'restaurantName', 'RestaurantName'),
        getField(item, 'cuisineType', 'CuisineType'),
        getField(item, 'description', 'Description'),
        order?.orderId,
        order?.status,
        order?.pickupTime,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [sortedOrders, searchQuery]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">My Orders</h1>
        <p className="mt-2 text-slate-600">Active pickups and past orders</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-xl">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search orders..."
            className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-4 focus:ring-ring/20"
          />
        </div>

        {orders.length > 0 && (
          <Button type="button" variant="outline" onClick={clearOrders}>
            Clear all
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {visibleOrders.length} order{visibleOrders.length !== 1 ? 's' : ''}
      </p>

      {orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <PackageIcon className="size-5 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">No orders yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Once you complete checkout, your orders will appear here.
          </p>
        </div>
      ) : visibleOrders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
          <h2 className="text-lg font-semibold text-foreground">No matches found</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Try a different search term.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleOrders.map((order, idx) => (
            <OrderCard
              key={order?.lineKey || `${order?.orderId || 'order'}-${idx}`}
              order={order}
            />
          ))}
        </div>
      )}
    </div>
  );
}