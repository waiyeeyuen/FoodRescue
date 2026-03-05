const express = require('express');
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
    console.log("Recommendation orchestrator hit!");
    
    res.status(200).json({ 
        success: true, 
        message: "Here are your food recommendations from the orchestrator layer!",
        items: ["Apples", "Bread", "Milk"]
    });
});

app.listen(3000, '0.0.0.0', () => {
    console.log('Recommendation Orchestrator listening on port 3000');
});