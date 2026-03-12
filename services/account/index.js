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

const USERS = db.collection('users')
const JWT_SECRET = process.env.JWT_SECRET || 'foodrescue-secret' // Use env variable in production

// Register a new user account
app.post('/account/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing fields' }); // All fields are required
    }

    // Check if email is already registered
    const existing = await USERS.where('email', '==', email).get();
    if (!existing.empty) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10); // Hash password before storing

    const newUser = {
      username,
      email,
      password: hashedPassword,
      createdAt: new Date()
    };

    const docRef = await USERS.add(newUser);

    // Return token so the user is immediately logged in after registering
    const token = jwt.sign({ id: docRef.id, email, username }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token, user: { id: docRef.id, username, email } });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login to an existing user account
app.post('/account/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // Find user by email
    const snapshot = await USERS.where('email', '==', email).get();
    if (snapshot.empty) {
      return res.status(401).json({ error: 'Invalid email or password' }); // Generic message to avoid enumeration
    }

    const doc = snapshot.docs[0];
    const user = doc.data();

    const passwordMatch = await bcrypt.compare(password, user.password); // Verify hashed password
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Sign JWT with user identity
    const token = jwt.sign(
      { id: doc.id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: doc.id, username: user.username, email: user.email } });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a user account by ID
app.get('/account/:id', async (req, res) => {
  try {
    const doc = await USERS.doc(req.params.id).get();

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
