const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { exec } = require('child_process');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();
const axios = require('axios');

const app = express();


app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cloudinary Configuration
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'synsocial_uploads',
        resource_type: 'auto',
        public_id: (req, file) => Date.now() + '-' + file.originalname.split('.')[0],
    },
});
const upload = multer({ storage: storage });

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://RayeesaF:RayeesaF@cluster0.y50j1a9.mongodb.net/synsocial?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB Connected Successfully!"))
    .catch(err => console.error("MongoDB Connection Error:", err));

const userSchema = new mongoose.Schema({
    name: { type: String, default: "Student User" },
    course: String,
    bio: String
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', userSchema);

const postSchema = new mongoose.Schema({
    title: String,
    author: String,
    tag: String,
    pin: String,
    pinHint: String,
    content: String,
    link: String,
    code: String,
    docUrl: String,
    docName: String,
    upvotes: { type: Number, default: 0 },
    isBookmarked: { type: Boolean, default: false },
    comments: [
        {
            text: String,
            author: String,
            createdAt: { type: Date, default: Date.now }
        }
    ]
}, { timestamps: true });

const Post = mongoose.model('Post', postSchema);

app.get('/', (req, res) => res.send("Synsocial API Server is running!"));

// Get All Posts
const getPostsHandler = async (req, res) => {
    try {
        const posts = await Post.find().sort({ createdAt: -1 });
        res.json(posts);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
app.get('/api/posts', getPostsHandler);
app.get('/posts', getPostsHandler);

// Create Post Handler
const createPostHandler = async (req, res) => {
    try {
        const { title, author, tag, pin, pinHint, content, description, link, code } = req.body;
        let docUrl = "", docName = "";

        if (req.file) {
            docUrl = req.file.path; // Cloudinary secure permanent URL
            docName = req.file.originalname;
        }

        // Fixed: Use real author input if provided, otherwise fallback to "Student User"
        const finalAuthor = (author && author.trim() !== "" && author !== "undefined" && author !== "null") 
            ? author.trim() 
            : "Student User";

        const newPost = new Post({
            title: title || "Untitled Post",
            author: finalAuthor,
            tag: tag || "General",
            pin: pin ? String(pin).trim() : "",
            pinHint: pinHint || "",
            content: content || description || "",
            link: link || "",
            code: code || "",
            docUrl,
            docName
        });

        const savedPost = await newPost.save();
        res.status(201).json({ success: true, post: savedPost });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

app.post('/api/posts', upload.single('document'), createPostHandler);
app.post('/posts', upload.single('document'), createPostHandler);
app.post('/api/posts/create', upload.single('document'), createPostHandler);

// Upvote Post
app.post('/api/posts/upvote/:id', async (req, res) => {
    try {
        const post = await Post.findByIdAndUpdate(req.params.id, { $inc: { upvotes: 1 } }, { new: true });
        if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
        res.json({ success: true, upvotes: post.upvotes });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Bookmark Post
app.post('/api/posts/bookmark/:id', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
        
        post.isBookmarked = !post.isBookmarked;
        await post.save();
        res.json({ success: true, isBookmarked: post.isBookmarked });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Delete Post with PIN Verification & Hint Return
app.delete('/api/posts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { pin } = req.body;

        const post = await Post.findById(id);

        if (!post) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }

        if (post.pin && post.pin.trim() !== '' && post.pin !== pin) {
            return res.status(400).json({
                success: false,
                message: 'Incorrect PIN!',
                hint: post.pinHint || 'No hint provided for this post'
            });
        }

        await Post.findByIdAndDelete(id);
        res.json({ success: true, message: 'Post deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Add Comment to Post
app.post('/api/posts/:id/comment', async (req, res) => {
    try {
        const { text, author } = req.body;
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

        const commentAuthor = (author && author.trim() !== "" && author !== "undefined") ? author.trim() : "Student User";
        post.comments.push({ text: text.trim(), author: commentAuthor });
        await post.save();
        res.json({ success: true, comments: post.comments });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

let wandboxCompilers = [];

// Fetch available compilers from Wandbox on startup
async function loadCompilers() {
    try {
        const res = await axios.get('https://wandbox.org/api/list.json');
        wandboxCompilers = res.data;
    } catch (e) {
        console.error("Could not fetch Wandbox compilers list");
    }
}
loadCompilers();

app.post('/api/run-code', async (req, res) => {
    try {
        let { language, code, stdin } = req.body;
        const lang = (language || '').toLowerCase().trim();

        // If list is empty, fetch it immediately
        if (wandboxCompilers.length === 0) {
            try {
                const resList = await axios.get('https://wandbox.org/api/list.json');
                wandboxCompilers = resList.data;
            } catch (e) {}
        }

        let compilerChoice = 'gcc-head';
        let fileName = 'prog.c';

        if (lang.includes('javascript') || lang === 'js' || lang === 'node') {
            const match = wandboxCompilers.find(c => c.name.includes('nodejs') || c.name.includes('node') || c.language === 'JavaScript');
            compilerChoice = match ? match.name : 'nodejs-head';
            fileName = 'prog.js';
        } else if (lang.includes('python') || lang === 'py') {
            const match = wandboxCompilers.find(c => c.name.includes('python') || c.name.includes('cpython') || c.language === 'Python');
            compilerChoice = match ? match.name : 'cpython-head';
            fileName = 'prog.py';
        } else if (lang.includes('java')) {
            const match = wandboxCompilers.find(c => c.name.includes('openjdk') || c.name.includes('java') || c.language === 'Java');
            compilerChoice = match ? match.name : 'openjdk-head';
            fileName = 'Main.java';
            code = code.replace(/public\s+class\s+[A-Za-z0-9_]+/g, 'public class Main');
        } else if (lang.includes('cpp') || lang.includes('c++')) {
            const match = wandboxCompilers.find(c => (c.name.includes('gcc') && c.name.includes('c++')) || c.name.includes('clang') || c.language === 'C++');
            compilerChoice = match ? match.name : 'gcc-head';
            fileName = 'prog.cpp';
        } else if (lang === 'c') {
            const match = wandboxCompilers.find(c => c.name === 'gcc-head' || c.language === 'C');
            compilerChoice = match ? match.name : 'gcc-head';
            fileName = 'prog.c';
        }

        const response = await axios.post('https://wandbox.org/api/compile.json', {
            compiler: compilerChoice,
            code: code,
            file: fileName,
            stdin: stdin || ''
        });

        const result = response.data;
        res.json({
            run: {
                output: result.program_output || '',
                stderr: result.program_error || result.compiler_error || ''
            }
        });
    } catch (error) {
        console.error("Code execution error:", error.response?.data || error.message);
        const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
        res.status(500).json({ success: false, message: "API Error: " + errorDetails });
    }
});
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));