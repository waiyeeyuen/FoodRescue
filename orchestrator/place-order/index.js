const express = require('express');
const app = express();

app.use(express.json());

app.post('/place-order', (req, res) => {
    console.log("Place Order orchestrator hit!");
    console.log("Received data:", req.body);
    
    res.status(200).json({ 
        success: true, 
        message: "Order placed successfully via the orchestrator layer!",
        receivedData: req.body
    });
});

app.listen(3000, '0.0.0.0', () => {
    console.log('Place Order Orchestrator listening on port 3000');
});