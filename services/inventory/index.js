import express from 'express'
import cors from 'cors'
import {db} from '../firebase/firebaseAdmin.js'

const app = express()

const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
};
app.use(cors(corsOptions))
app.use(express.json())

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

// Post a new inventory item
app.post("/inventory", async (req, res) => {
  try {
    const { name, quantity, supplier } = req.body;

    if (!name || !quantity || !supplier) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const expiry = new Date(Date.now() + 5 * 60 * 60 * 1000);

    const newItem = {
      name,
      quantity,
      supplier,
      expiry
    };

    const docRef = await INVENTORY.add(newItem);

    res.status(201).json({ id: docRef.id, ...newItem });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update an inventory item
app.put("/inventory/:id", async (req, res) => {
  try {
    const docRef = INVENTORY.doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Not found" });
    }

    const { name, quantity, supplier } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (quantity !== undefined) updates.quantity = quantity;
    if (supplier !== undefined) updates.supplier = supplier;

    await docRef.update(updates);
    res.json({ id: req.params.id, ...doc.data(), ...updates });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete an inventory item
app.delete("/inventory/:id", async (req, res) => {
  try {
    const docRef = INVENTORY.doc(req.params.id);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: "Not found" }); 
    }

    await docRef.delete();
    res.json({ message: "Deleted successfully" }); 

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});