function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

const gatewayUrl = normalizeBaseUrl(
  import.meta.env.VITE_GATEWAY_URL || 'http://localhost:8000'
);

function withGatewayFallback(value) {
  return normalizeBaseUrl(value) || gatewayUrl;
}

export const GATEWAY_URL = gatewayUrl;
export const ACCOUNT_SERVICE_URL = withGatewayFallback(import.meta.env.VITE_ACCOUNT_SERVICE_URL);
export const INVENTORY_SERVICE_URL = withGatewayFallback(import.meta.env.VITE_INVENTORY_SERVICE_URL);
export const PLACE_ORDER_SERVICE_URL = withGatewayFallback(import.meta.env.VITE_PLACE_ORDER_SERVICE_URL);
export const RECOMMENDATION_SERVICE_URL = withGatewayFallback(
  import.meta.env.VITE_RECOMMENDATION_SERVICE_URL
);
export const ORDER_SERVICE_URL = withGatewayFallback(import.meta.env.VITE_ORDER_SERVICE_URL);
export const PAYMENT_SERVICE_URL = withGatewayFallback(import.meta.env.VITE_PAYMENT_SERVICE_URL);
export const NOTIFICATION_SERVICE_URL = withGatewayFallback(
  import.meta.env.VITE_NOTIFICATION_SERVICE_URL
);
export const DELETE_LISTING_SERVICE_URL = withGatewayFallback(
  import.meta.env.VITE_DELETE_LISTING_SERVICE_URL
);
