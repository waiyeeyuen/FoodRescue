const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// inventory service address
const INVENTORY_SERVICE = "http://localhost:8000";

app.delete('/', async (req, res) => {
    console.log("Expiry orchestrator hit!");

    try {

        // Call inventory service
        const inventory = await axios.get(`${INVENTORY_SERVICE}/inventory`);

        console.log("Inventory received:", inventory.data);

        res.status(200).json({
            success: true,
            message: "Expired food removal initiated from the orchestrator layer!",
            inventory: inventory.data
        });

    } catch (error) {

        console.error("Error calling inventory service:", error.message);

        res.status(500).json({
            success: false,
            error: "Failed to call inventory service"
        });

    }
});

app.listen(3000, '0.0.0.0', () => {
    console.log('Expiry Orchestrator listening on port 3000');
});