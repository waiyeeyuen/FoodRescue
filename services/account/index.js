import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { db } from '../firebase/firebaseAdmin.js'

const app = express()

const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
};
app.use(cors(corsOptions))
app.use(express.json())

const RESTAURANTS = db.collection('restaurants')
const JWT_SECRET = process.env.JWT_SECRET || 'foodrescue-secret' // Use env variable in production

// Register a new restaurant account
app.post('/account/register', async (req, res) => {
  try {
    const { email, password, restaurantName } = req.body;

    if (!email || !password || !restaurantName) {
      return res.status(400).json({ error: 'Missing fields' }); // All fields are required
    }

    // Check if email is already registered
    const existing = await RESTAURANTS.where('email', '==', email).get();
    if (!existing.empty) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10); // Hash password before storing

    const newRestaurant = {
      email,
      password: hashedPassword,
      restaurantName,
      createdAt: new Date()
    };

    const docRef = await RESTAURANTS.add(newRestaurant);

    // Return token so the user is immediately logged in after registering
    const token = jwt.sign({ id: docRef.id, email, restaurantName }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token, restaurant: { id: docRef.id, email, restaurantName } });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login to an existing restaurant account
app.post('/account/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // Find restaurant by email
    const snapshot = await RESTAURANTS.where('email', '==', email).get();
    if (snapshot.empty) {
      return res.status(401).json({ error: 'Invalid email or password' }); // Generic message to avoid enumeration
    }

    const doc = snapshot.docs[0];
    const restaurant = doc.data();

    const passwordMatch = await bcrypt.compare(password, restaurant.password); // Verify hashed password
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Sign JWT with restaurant identity
    const token = jwt.sign(
      { id: doc.id, email: restaurant.email, restaurantName: restaurant.restaurantName },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, restaurant: { id: doc.id, email: restaurant.email, restaurantName: restaurant.restaurantName } });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a restaurant account by ID
app.get('/account/:id', async (req, res) => {
  try {
    const doc = await RESTAURANTS.doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { password, ...safeData } = doc.data(); // Exclude password from response

    res.json({ id: doc.id, ...safeData });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Account service running on port ${PORT}`);
});
