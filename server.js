const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// --- 1. MIDDLEWARES ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 2. FILE UPLOADS SETUP ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// --- 3. MONGOOSE SCHEMA & MODEL ---
const postSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: { type: String, required: true },
    tag: { type: String, default: 'General' },
    content: { type: String, required: true },
    code: { type: String, default: '' },
    pin: { type: String, required: true },
    pinHint: { type: String, default: '' },
    link: { type: String, default: '' },
    docUrl: { type: String, default: '' },
    upvotes: { type: Number, default: 0 },
    isBookmarked: { type: Boolean, default: false },
    comments: [{
        author: { type: String, default: 'Anonymous' },
        text: { type: String, required: true },
        createdAt: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', postSchema);

// --- 4. MONGODB CONNECTION ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://RayeesaF:RayeesaF@cluster0.y50j1a9.mongodb.net/?appName=Cluster0&retryWrites=true&w=majority";
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected Successfully'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- 5. API ROUTES ---

// GET: Fetch all posts for Feed Workspace & Search Hub
app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ createdAt: -1 });
        res.status(200).json(posts);
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch posts', error: err.message });
    }
});

// POST: Create a new post with document upload & code snippet
app.post('/api/posts', upload.single('doc'), async (req, res) => {
    try {
        const { title, author, tag, content, code, pin, pinHint, link } = req.body;
        
        if (!title || !author || !content || !pin) {
            return res.status(400).json({ success: false, message: 'Required fields missing!' });
        }

        const docUrl = req.file ? `uploads/${req.file.filename}` : '';

        const newPost = new Post({
            title,
            author,
            tag: tag || 'General',
            content,
            code: code || '',
            pin,
            pinHint: pinHint || '',
            link: link || '',
            docUrl
        });

        await newPost.save();
        res.status(201).json({ success: true, message: 'Post created successfully!', post: newPost });
    } catch (err) {
        console.error("Create Post Error:", err);
        res.status(500).json({ success: false, message: 'Server error while creating post', error: err.message });
    }
});

// GET: Profile Statistics & User Uploads
app.get('/api/profile/stats', async (req, res) => {
    try {
        const authorName = req.query.author || "Rayeesa";
        const userPosts = await Post.find({ author: new RegExp(`^${authorName}$`, 'i') }).sort({ createdAt: -1 });
        const allPosts = await Post.find();
        
        const totalUpvotes = userPosts.reduce((acc, p) => acc + (p.upvotes || 0), 0);
        const bookmarkedPosts = allPosts.filter(p => p.isBookmarked);

        res.status(200).json({
            myUploadsCount: userPosts.length,
            upvotesReceived: totalUpvotes,
            bookmarksCount: bookmarkedPosts.length,
            uploads: userPosts,
            bookmarks: bookmarkedPosts
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch profile stats', error: err.message });
    }
});

// DELETE: Delete Post with PIN Verification
app.delete('/api/posts/:id', async (req, res) => {
    try {
        const { pin } = req.body;
        const post = await Post.findById(req.params.id);

        if (!post) {
            return res.status(404).json({ success: false, message: 'Post not found!' });
        }

        if (post.pin !== pin) {
            return res.status(401).json({ success: false, message: 'Incorrect Security PIN!' });
        }

        await Post.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Post deleted successfully!' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error deleting post', error: err.message });
    }
});

// PUT: Upvote Post
app.put('/api/posts/:id/upvote', async (req, res) => {
    try {
        const post = await Post.findByIdAndUpdate(
            req.params.id, 
            { $inc: { upvotes: 1 } }, 
            { new: true }
        );
        res.status(200).json(post);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT: Toggle Bookmark
app.put('/api/posts/:id/bookmark', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ message: 'Post not found' });

        post.isBookmarked = !post.isBookmarked;
        await post.save();
        res.status(200).json(post);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST: Add Comment
app.post('/api/posts/:id/comments', async (req, res) => {
    try {
        const { author, text } = req.body;
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ message: 'Post not found' });

        post.comments.push({ author: author || 'Anonymous', text });
        await post.save();
        res.status(201).json(post);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- 6. START SERVER ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
});