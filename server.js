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

// 1. Code Runner Route with robust error catching
// 1. PDF Download Route Fix (Avoids Cloudinary ACL deny error)
app.get('/api/download-pdf', async (req, res) => {
    try {
        const pdfUrl = req.query.url;
        if (!pdfUrl) {
            return res.status(400).json({ success: false, message: "PDF URL not provided" });
        }
        // Remove fl_attachment if it causes ACL denial, and redirect directly to secure URL
        const cleanUrl = pdfUrl.replace('/fl_attachment/', '/');
        res.redirect(cleanUrl);
    } catch (error) {
        console.error("PDF download error:", error.message);
        res.status(500).json({ success: false, message: "Could not download PDF file." });
    }
});

// 2. Code Runner Route (Proper error details logging)
// 1. PDF Download Route: Fixes Cloudinary ACL failure by removing restrictive flags 
// and streaming or redirecting cleanly
app.get('/api/download-pdf', async (req, res) => {
    try {
        let pdfUrl = req.query.url;
        if (!pdfUrl) {
            return res.status(400).json({ success: false, message: "PDF URL not provided" });
        }
        
        // Remove fl_attachment flag completely to prevent Cloudinary 401 ACL deny error
        let cleanUrl = pdfUrl.replace(/\/fl_attachment\/v/, '/v');
        
        // Redirect user to the clean, accessible Cloudinary file URL
        res.redirect(cleanUrl);
    } catch (error) {
        console.error("PDF download error:", error.message);
        res.status(500).json({ success: false, message: "Could not download PDF file." });
    }
});

// 2. Code Runner Route: Using a stable public execution endpoint or fallback
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// 1. PDF Download Route Fix (Removes Cloudinary fl_attachment to prevent ACL denial)
app.get('/api/download-pdf', async (req, res) => {
    try {
        let pdfUrl = req.query.url;
        if (!pdfUrl) {
            return res.status(400).json({ success: false, message: "PDF URL not provided" });
        }
        let cleanUrl = pdfUrl.replace(/\/fl_attachment\/v/, '/v');
        res.redirect(cleanUrl);
    } catch (error) {
        console.error("PDF download error:", error.message);
        res.status(500).json({ success: false, message: "Could not download PDF file." });
    }
});

// 2. Bulletproof Code Execution Route (Handles Python, Java, C, C++, JS with stdin)
app.post('/api/run-code', async (req, res) => {
    let { language, code, stdin } = req.body;
    const lang = (language || '').toLowerCase().trim();
    
    // Create a temporary directory for execution if it doesn't exist
    const tmpDir = path.join(__dirname, 'tmp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    const uniqueId = Date.now() + Math.random().toString(36.2, 7);
    let fileName = 'main.py';
    let cmd = '';

    if (lang.includes('javascript') || lang === 'js' || lang === 'node') {
        fileName = `script_${uniqueId}.js`;
        fs.writeFileSync(path.join(tmpDir, fileName), code);
        cmd = `node ${path.join(tmpDir, fileName)}`;
    } else if (lang.includes('python') || lang === 'py') {
        fileName = `script_${uniqueId}.py`;
        fs.writeFileSync(path.join(tmpDir, fileName), code);
        cmd = `python3 ${path.join(tmpDir, fileName)}`;
    } else if (lang.includes('cpp') || lang.includes('c++')) {
        fileName = `script_${uniqueId}.cpp`;
        const exeName = `exec_${uniqueId}`;
        const exePath = path.join(tmpDir, exeName);
        fs.writeFileSync(path.join(tmpDir, fileName), code);
        cmd = `g++ ${path.join(tmpDir, fileName)} -o ${exePath} && ${exePath}`;
    } else if (lang === 'c') {
        fileName = `script_${uniqueId}.c`;
        const exeName = `exec_${uniqueId}`;
        const exePath = path.join(tmpDir, exeName);
        fs.writeFileSync(path.join(tmpDir, fileName), code);
        cmd = `gcc ${path.join(tmpDir, fileName)} -o ${exePath} && ${exePath}`;
    } else if (lang.includes('java')) {
        // Java: Handle any public class name and extract it dynamically
        let className = 'Main';
        const matchClass = code.match(/(?:public\s+)?class\s+([A-Za-z0-9_]+)/);
        if (matchClass && matchClass[1]) {
            className = matchClass[1];
        }
        fileName = `${className}.java`;
        fs.writeFileSync(path.join(tmpDir, fileName), code);
        cmd = `javac ${path.join(tmpDir, fileName)} && java -cp ${tmpDir} ${className}`;
    } else {
        return res.json({ run: { output: '', stderr: 'Unsupported language selected.' } });
    }

    const filePath = path.join(tmpDir, fileName);

    // Execute with stdin support and a strict 8-second timeout
    const child = exec(cmd, { timeout: 8000 }, (error, stdout, stderr) => {
        // Clean up temporary files safely
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            if (lang.includes('java')) {
                const classPath = path.join(tmpDir, '*.class');
                exec(`rm -f ${path.join(tmpDir, '*.class')} ${path.join(tmpDir, 'exec_*')}`);
            }
        } catch (e) {}

        if (error && error.killed) {
            return res.json({ run: { output: stdout || '', stderr: 'Execution Timed Out (Infinite loop or waiting for input).' } });
        }

        res.json({
            run: {
                output: stdout || '',
                stderr: stderr || (error ? error.message : '')
            }
        });
    });

    // Send stdin if provided by the user
    if (stdin) {
        child.stdin.write(stdin);
        child.stdin.end();
    }
});
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));