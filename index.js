const cors = require('cors');
const express = require('express');
const app = express();
const port = process.env.PORT || 5000;
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Middleware
// const corsOptions = {
//     origin: [
//         'http://localhost:5173', // আপনার লোকাল ফ্রন্ট-এন্ডের URL (ঠিক আছে)
//         'https://bdhubshoe.web.app' // <<<<< এই লাইনটি পরিবর্তন করুন
//     ],
//     methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
//     allowedHeaders: ['Content-Type', 'Authorization'],
//     credentials: true,
// };

app.use(cors());
app.use(express.json());

// IMPROVED: Check for essential environment variables on startup
if (!process.env.DB_USER || !process.env.DB_PASS || !process.env.ACCESS_TOKEN_SECRET) {
  console.error("FATAL ERROR: Missing required environment variables (DB_USER, DB_PASS, ACCESS_TOKEN_SECRET).");
  process.exit(1); // Exit the application if config is missing
}

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.2qyatsn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    // await client.connect();
    const productCollection = client.db('bdHubShoe').collection('allProduct');
    const userCollection = client.db('bdHubShoe').collection('users');
    const cartsCollection = client.db('bdHubShoe').collection('carts');

    // =================================================================
    // MIDDLEWARE
    // =================================================================

    // JWT Token Generation
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      // CHANGED: Using a clearly named secret from .env
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '1h'
      });
      res.send({ token });
    });

    // Middleware to verify JWT token
    const verifyToken = (req, res, next) => {
      // ================== VERCEL DEBUGGING LOGS START ==================
      console.log('--- NEW REQUEST RECEIVED ---');
      console.log('Request Path:', req.path);
      console.log('Full Headers:', JSON.stringify(req.headers, null, 2));
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.error('Error: Authorization header is missing or does not start with "Bearer ".');
        // IMPROVED: Clearer message for 401 status
        return res.status(401).send({ message: 'unauthorized access' });
      }

      const token = authHeader.split(' ')[1];
      // =================== VERCEL DEBUGGING LOGS END ===================
      console.log(process.env.ACCESS_TOKEN_SECRET, 'jwt seccret');
      // CHANGED: Verifying with the correct secret variable
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          // 403 is appropriate here: we received a token, but it's not valid.
          console.error('4. JWT VERIFY FAILED! Error:', err.name, 'Message:', err.message);
          return res.status(403).send({ message: 'forbidden access' });
        } else {
          console.log('5. JWT verification successful!');
          req.decoded = decoded; // Attach decoded payload to the request
          next();
        }
      });
    };

    // Middleware to verify admin role (must be used AFTER verifyToken)
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      next(); // Only call next() if the user is an admin
    };

    // =================================================================
    // ROUTES
    // =================================================================

    // --- Product Routes (Public) ---
    app.get('/product', async (req, res) => {
      const data = await productCollection.find().toArray();
      res.send(data);
    });

    app.get('/product/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productCollection.findOne(query);
      res.send(result);
    });
    app.post('/product', verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await productCollection.insertOne(item);
      res.send(result)
    })
    app.delete('/product/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await productCollection.deleteOne(query)
      res.send(result)
    })
    app.patch('/product/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          category: req.body.category,
          price: req.body.category,
          image: req.body.image,
          name: req.body.image
        }
      }
      const result = await productCollection.updateOne(filter, updateDoc);
      res.send(result)
    })

    //Search Product 
    app.get('/products/search', async (req, res) => {
      const { q } = req.query;
      if (!q) {
        return res.send([]); // Query না থাকলে খালি অ্যারে পাঠানো হবে
      }
      const products = await productCollection.find().toArray()
      const searchTerm = q.toLowerCase();

      const filteredProducts = products.filter(product =>
        product.name.toLowerCase().includes(searchTerm)
      );

      res.send(filteredProducts);
    });

    // API Endpoint for search suggestions (by name only)
    app.get('/products/suggestions', async (req, res) => {
      const { q } = req.query;
      console.log(q);
      const products = await productCollection.find().toArray()
      if (!q) {
        return res.json([]);
      }

      const searchTerm = q.toLowerCase();

      const suggestedProducts = products
        .filter(product => product.name.toLowerCase().startsWith(searchTerm))
        .map(product => product.name) // শুধু নামগুলো পাঠানো হচ্ছে
        .slice(0, 10) ; // সর্বোচ্চ ১০টি সাজেশন পাঠানো হবে

      res.json(suggestedProducts);
    });

    // --- User Routes ---
    app.post('/user', async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'user already exists', insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // Check if a user is an admin. Protected by verifyToken.
    app.get('/user/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      // This check is important: it ensures a user can only check their own admin status.
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'unauthorized access' });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user.role === 'admin';
      }
      res.send({ admin });
    });

    // --- Admin-Only User Management Routes ---
    app.get('/users', async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: 'admin'
        }
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // --- Cart Routes (Now Secure) ---

    // CHANGED: Added verifyToken middleware to protect this route
    app.post('/carts', verifyToken, async (req, res) => {
      const cartItem = req.body;
      // IMPROVED: Add the user's email from the token to ensure data integrity
      cartItem.email = req.decoded.email;
      const result = await cartsCollection.insertOne(cartItem);
      res.send(result);
    });

    // CHANGED & FIXED: Added verifyToken and changed logic to get user's own cart
    app.get('/carts', verifyToken, async (req, res) => {
      // FIXED: Get email from the verified token, not a query parameter
      const email = req.decoded.email;
      const query = { email: email };
      const result = await cartsCollection.find(query).toArray();
      res.send(result);
    });

    // CHANGED: Added verifyToken to ensure a user can only delete items from their own cart.
    // While this works, a more robust check would also verify the email in the cart item matches req.decoded.email.
    app.delete('/carts/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = {
        _id: new ObjectId(id),
        email: req.decoded.email // IMPORTANT: Ensures users can't delete items from others' carts
      };
      const result = await cartsCollection.deleteOne(query);
      // IMPROVED: Check if anything was actually deleted
      if (result.deletedCount === 0) {
        return res.status(404).send({ message: 'Cart item not found or you do not have permission to delete it.' });
      }
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // In a long-running server application, you DON'T want to close the connection here.
    // So, leaving `await client.close()` commented out is correct.
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('bdHub server is running');
});

app.listen(port, () => {
  console.log(`bdHub server started on port ${port}`);
});

