import express from "express";
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore/lite';

const firebaseConfig = {
  apiKey: "AIzaSyBuW8dV9QHxzhEJJ8UYXtc5NECBkzBkm1Q",
  authDomain: "foodrescue-750db.firebaseapp.com",
  projectId: "foodrescue-750db",
  storageBucket: "foodrescue-750db.firebasestorage.app",
  messagingSenderId: "82271290903",
  appId: "1:82271290903:web:98abe3908953cd5867be52",
  measurementId: "G-KLZQJP1NEZ"
};
const firebase = initializeApp(firebaseConfig);
const db = getFirestore(firebase);

const app = express();
app.use(express.json());

// Final microservice: inventory-service → Firebase DB
app.get("/inventory", async (req, res) => {
  console.log("[GET] /inventory");
  try {
    const inventoryCol = collection(db, 'inventory');
    const inventorySnapshot = await getDocs(inventoryCol);
    const inventoryList = inventorySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(inventoryList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

app.post("/inventory/update",(req,res)=>{
  console.log("[POST] /inventory/update");
  res.json({message:"inventory updated"})
})

app.listen(3000, () => {
  console.log("Inventory service started on port 3000");
  console.log("Firebase connected to project:", firebaseConfig.projectId);
})