const { checkItemAvailability, reserveItem } = require('../repository/orderRepository');

// Service layer: orchestrates the business logic for creating an order
const createOrder = async ({ itemId, quantity, userId }) => {
    console.log("[Service] createOrder() → starting order workflow");

    // Step 1: Check item availability in inventory (hits Firebase via inventory-service)
    console.log("[Service] Step 1: Checking inventory...");
    const item = await checkItemAvailability(itemId, quantity);

    // Step 2: Reserve the item (update inventory)
    console.log("[Service] Step 2: Reserving item in inventory...");
    await reserveItem(itemId, quantity);

    // Step 3: Build order result
    const order = {
        orderId: `ord_${Date.now()}`,
        userId,
        itemId,
        itemName: item.name,
        quantity,
        totalPrice: item.price * quantity,
        status: "confirmed",
        createdAt: new Date().toISOString()
    };

    console.log("[Service] createOrder() → order created:", order.orderId);
    return order;
};

module.exports = { createOrder };
