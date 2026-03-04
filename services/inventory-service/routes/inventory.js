import express from "express";
import { db } from "../firebaseAdmin.js";

const router = express.Router();
const INVENTORY = db.collection("inventory");


// CREATE
// router.post("/", async (req, res) => {
//   try {
//     const { title, done = false } = req.body;

//     if (!title) {
//       return res.status(400).json({ error: "title required" });
//     }

//     const now = new Date();

//     const docRef = await INVENTORY.add({
//       title,
//       done,
//       createdAt: now,
//       updatedAt: now
//     });

//     const doc = await docRef.get();

//     res.status(201).json({
//       id: doc.id,
//       ...doc.data()
//     });

//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });


// READ ALL
router.get("/", async (req, res) => {
  try {
    const snapshot = await INVENTORY.get();

    const todos = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(todos);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// READ ONE
router.get("/:id", async (req, res) => {
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



export default router;