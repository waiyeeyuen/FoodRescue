const express = require('express');
const { createOrder } = require('./src/services/orderService');

const app = express();
app.use(express.json());

// Orchestrator API: handles checkout flow and order creation

// POST /order → Service: createOrder() → Repository: Order.create() → inventory-service → Firebase DB
app.post('/order', async (req, res) => {
    console.log("[API] POST /order hit");
    console.log("[API] Request body:", req.body);

    const { itemId, quantity, userId } = req.body;

    if (!itemId || !quantity || !userId) {
        return res.status(400).json({ error: "itemId, quantity, and userId are required" });
    }

    try {
        const order = await createOrder({ itemId, quantity, userId });
        res.status(200).json({ success: true, order });
    } catch (error) {
        console.error("[API] Order failed:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(3000, '0.0.0.0', () => {
    console.log('Checkout Orchestrator listening on port 3000');
});