import express from 'express'
import cors from 'cors'
import {db} from './firebaseAdmin.js'

const app = express()

const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
};
app.use(cors(corsOptions))

const INVENTORY = db.collection('inventory')

// Get all inventory items
app.get('/inventory', async (req, res) => {
  try {
    const snapshot = await INVENTORY.get();

    const response = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(response);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
})

// Get specific inventory item
app.get("/inventory/:id", async (req, res) => {
  try {
    const doc = await INVENTORY.doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Not found" });
    }

    res.json({
      id: doc.id,
      ...doc.data()
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});