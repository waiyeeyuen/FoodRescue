const axios = require('axios');

const INVENTORY_SERVICE_URL = "http://inventory-service:3000";

// Repository layer: interacts with inventory-service to check availability and reserve items
// Calls inventory-service which reads directly from Firebase DB
const getInventory = async () => {
    console.log("[Repository] Order.getInventory() → calling inventory-service");
    const response = await axios.get(`${INVENTORY_SERVICE_URL}/inventory`);
    return response.data;
};

const checkItemAvailability = async (itemId, quantity) => {
    console.log(`[Repository] Order.checkItemAvailability() → itemId: ${itemId}, qty: ${quantity}`);
    const inventory = await getInventory();
    const item = inventory.find(i => i.id === itemId);
    if (!item) throw new Error(`Item ${itemId} not found in inventory`);
    if (item.quantity < quantity) throw new Error(`Insufficient stock for item ${itemId}`);
    return item;
};

const reserveItem = async (itemId, quantity) => {
    console.log(`[Repository] Order.reserveItem() → updating inventory for itemId: ${itemId}`);
    const response = await axios.post(`${INVENTORY_SERVICE_URL}/inventory/update`, {
        itemId,
        quantity
    });
    return response.data;
};

module.exports = { getInventory, checkItemAvailability, reserveItem };
