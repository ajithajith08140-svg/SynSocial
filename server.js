const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
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

// Multer setup using memoryStorage (Files are stored temporarily in RAM and saved directly into MongoDB as Binary Buffer)
const upload = multer({ storage: multer.memoryStorage() });

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

// Post Schema with direct MongoDB binary file storage (Supports up to 16MB per file)
const postSchema = new mongoose.Schema({
    title: String,
    author: String,
    tag: String,
    pin: String,
    pinHint: String,
    content: String,
    link: String,
    code: String,
    docName: String,
    docContentType: String,
    docData: Buffer, // Binary file buffer stored directly in MongoDB
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

// Get All Posts (Excluding heavy binary data for list view, attaching clean download URL)
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://synsocial.onrender.com';
const getPostsHandler = async (req, res) => {
    try {
        const posts = await Post.find().sort({ createdAt: -1 }).select('-docData');
        const formattedPosts = posts.map(post => {
            const obj = post.toObject();
            if (obj.docName) {
                obj.docUrl = `${RENDER_URL}/api/posts/document/${post._id}`;
            }
            return obj;
        });
        res.json(formattedPosts);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
app.get('/api/posts', getPostsHandler);
app.get('/posts', getPostsHandler);

// Create Post Handler (Stores uploaded file buffer directly in MongoDB)
const createPostHandler = async (req, res) => {
    try {
        const { title, author, tag, pin, pinHint, content, description, link, code } = req.body;
        
        let docName = "";
        let docContentType = "";
        let docData = null;

        if (req.file) {
            docName = req.file.originalname;
            docContentType = req.file.mimetype;
            docData = req.file.buffer;
        }

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
            docName,
            docContentType,
            docData
        });

        const savedPost = await newPost.save();
        
        const responseObj = savedPost.toObject();
        if (responseObj.docName) {
            responseObj.docUrl = `${RENDER_URL}/api/posts/document/${savedPost._id}`;
            delete responseObj.docData;
        }

        res.status(201).json({ success: true, post: responseObj });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

app.post('/api/posts', upload.single('document'), createPostHandler);
app.post('/posts', upload.single('document'), createPostHandler);
app.post('/api/posts/create', upload.single('document'), createPostHandler);

// Retrieve / Download Document Route directly from MongoDB
app.get('/api/posts/document/:id', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post || !post.docData) {
            return res.status(404).json({ success: false, message: "Document not found in database" });
        }

        res.setHeader('Content-Type', post.docContentType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${post.docName || 'document'}"`);
        return res.send(post.docData);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Backward compatibility route if frontend calls /api/download-pdf
app.get('/api/download-pdf', async (req, res) => {
    try {
        const postId = req.query.id;
        if (!postId) {
            return res.status(400).json({ success: false, message: "Post ID not provided" });
        }
        return res.redirect(`/api/posts/document/${postId}`);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

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

// Delete Post with PIN Verification
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

// Code Execution Route using Judge0 (Supports Java, Python, C, C++, JS with Stdin)
// Code Execution Route using Judge0 (Supports Java, Python, C, C++, JS with Stdin)
app.post('/api/run-code', async (req, res) => {
    let { language, code, stdin } = req.body;
    const lang = (language || '').toLowerCase().trim();
    
    let languageId = 92; // Default Python 3

    if (lang.includes('javascript') || lang === 'js' || lang === 'node') {
        languageId = 93; // Node.js
        const promptShim = `
        const fs = require('fs');
        const _inputLines = fs.readFileSync(0, 'utf-8').split(/\\r?\\n/);
        let _lineIdx = 0;
        function prompt(msg) {
            if (msg) process.stdout.write(msg);
            return _inputLines[_lineIdx++] || '';
        }
        `;
        code = promptShim + '\n' + code;
    } else if (lang.includes('python') || lang === 'py') {
        languageId = 92; // Python 3
    } else if (lang.includes('cpp') || lang.includes('c++')) {
        languageId = 54; // C++ (GCC)
    } else if (lang === 'c') {
        languageId = 50; // C (GCC)
    } else if (lang.includes('java')) {
        languageId = 62; // Java (OpenJDK)
        code = code.replace(/public\s+class\s+[A-Za-z0-9_]+/g, 'public class Main');
    } else {
        return res.json({ run: { output: '', stderr: 'Unsupported language selected.' } });
    }

    try {
        const response = await axios.post('https://ce.judge0.com/submissions?base64_encoded=false&wait=true', {
            language_id: languageId,
            source_code: code,
            stdin: stdin || ''
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = response.data;
        let output = result.stdout || '';
        const stderr = result.stderr || result.compile_output || result.message || '';

        
        if (stdin && stdin.trim() !== '' && output.includes(':')) {
            const inputLines = stdin.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            let lineIndex = 0;
            
            
            output = output.replace(/([^:\n]+\s*:\s*)/g, (match) => {
                if (lineIndex < inputLines.length) {
                    const val = inputLines[lineIndex];
                    lineIndex++;
                    return match + val + '\n';
                }
                return match;
            });
        }

        res.json({
            run: {
                output: output,
                stderr: stderr
            }
        });
    } catch (err) {
        res.json({
            run: {
                output: '',
                stderr: 'Execution API Error: ' + (err.response?.data?.message || err.message)
            }
        });
    }
});
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));