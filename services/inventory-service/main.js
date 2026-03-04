import express from "express";
import inventoryRouter from "./routes/inventory.js";

const app = express();

app.use(express.json());

app.use("/inventory", inventoryRouter);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});