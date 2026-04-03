import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 4002;
const INVENTORY_SERVICE_URL =
  process.env.INVENTORY_SERVICE_URL || "http://localhost:3000";

const corsOrigins = (process.env.CORS_ORIGINS ||
  "http://localhost:3000,http://localhost:5173"
)
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins
  })
);
app.use(express.json());

async function readBody(response) {
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!raw) return null;
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "composite-upload-listing"
  });
});

async function proxyCreateListing(req, res) {
  try {
    const response = await fetch(`${INVENTORY_SERVICE_URL}/inventory/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {})
    });

    const body = await readBody(response);
    res.status(response.status).json(body);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to upload listing" });
  }
}

async function proxyGetRestaurantListings(req, res) {
  try {
    const response = await fetch(
      `${INVENTORY_SERVICE_URL}/inventory/restaurant/${encodeURIComponent(
        req.params.restaurantId
      )}`
    );
    const body = await readBody(response);
    res.status(response.status).json(body);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to fetch listings" });
  }
}

async function proxyGetDeletedRestaurantListings(req, res) {
  try {
    const response = await fetch(
      `${INVENTORY_SERVICE_URL}/inventory/restaurant/${encodeURIComponent(
        req.params.restaurantId
      )}/deleted`
    );
    const body = await readBody(response);
    res.status(response.status).json(body);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to fetch deleted listings" });
  }
}

async function proxyUploadImage(req, res) {
  try {
    const contentType = req.headers["content-type"] || "";
    const response = await fetch(`${INVENTORY_SERVICE_URL}/inventory/upload-image`, {
      method: "POST",
      headers: contentType ? { "Content-Type": contentType } : undefined,
      body: req,
      duplex: "half",
    });

    const body = await readBody(response);
    res.status(response.status).json(body);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to upload image" });
  }
}

app.post("/listings", proxyCreateListing);
app.post("/listings/upload", proxyCreateListing);
app.post("/listings/upload-image", proxyUploadImage);
app.get("/listings/restaurant/:restaurantId", proxyGetRestaurantListings);
app.get("/listings/restaurant/:restaurantId/deleted", proxyGetDeletedRestaurantListings);

app.listen(PORT, () => {
  console.log(`Composite upload-listing service running on port ${PORT}`);
});
