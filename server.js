const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// 1. Fixed CORS Configuration
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Health Check Endpoint
app.get('/', (req, res) => {
    res.send("Synsocial API Server is running!");
});

// 3. MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || "your_mongodb_connection_string_here";

mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB Connected Successfully!"))
    .catch(err => console.error("MongoDB Connection Error:", err));

// 4. Schema & Routes (Ensure your posts routes are defined here)



// 2. Configure Multer Storage for Document Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// 3. API Routes

// Test Route
app.get('/', (req, res) => {
    res.send('Synsocial API Server is running!');
});

// Create Post and Save to MongoDB
app.post('/api/posts/create', upload.single('document'), async (req, res) => {
    try {
        const { title, author, tag, pin, pinHint, content, link, code } = req.body;

        let docUrl = "";
        let docName = "";

        if (req.file) {
            docUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;
            docName = req.file.originalname;
        }

        const newPost = new Post({
            title,
            author,
            tag,
            pin,
            pinHint,
            content,
            link,
            code,
            docUrl,
            docName
        });

        const savedPost = await newPost.save();
        res.status(201).json({ success: true, post: savedPost });
    } catch (err) {
        console.error('Error saving post:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Fetch All Posts from MongoDB
app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ createdAt: -1 });
        res.json(posts);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. Start Server
// 5. Dynamic Port Binding (CRITICAL FOR RENDER)
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});