const express = require('express');
const app = express();

app.use(express.json());

app.post('/', (req, res) => {
    console.log("Checkout orchestrator hit!");
    console.log("Received data:", req.body);
    
    res.status(200).json({ 
        success: true, 
        message: "Checkout successful from the orchestrator layer!",
        receivedData: req.body
    });
});

app.listen(3000, '0.0.0.0', () => {
    console.log('Checkout Orchestrator listening on port 3000');
});