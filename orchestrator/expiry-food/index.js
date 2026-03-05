const express = require('express');
const app = express();

app.use(express.json());

app.delete('/expiry', (req, res) => {
    console.log("Expiry orchestrator hit!");
    
    res.status(200).json({ 
        success: true, 
        message: "Expired food removal initiated from the orchestrator layer!" 
    });
});

app.listen(3000, '0.0.0.0', () => {
    console.log('Expiry Orchestrator listening on port 3000');
});