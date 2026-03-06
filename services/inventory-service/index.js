import express from 'express'
import {db} from './firebaseAdmin.js'

const app = express();
app.use(express.json());

const INVENTORY = db.collection('inventory')

app.get("/inventory",async (req,res)=>{
  res.json([
    {food:"bread",qty:10},
    {food:"milk",qty:5}
  ])
  // try {
  //   const snapshot = await INVENTORY.get();

  //   const todos = snapshot.docs.map(doc => ({
  //     id: doc.id,
  //     ...doc.data()
  //   }));

  //   res.json(todos);

  // } catch (err) {
  //   res.status(500).json({ error: err.message });
  // }
})

app.get("/inventory/:id", async (req,res)=>{
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
})

app.listen(3000)
