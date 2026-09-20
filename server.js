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
        allowed_formats: ['jpg', 'png', 'jpeg', 'pdf', 'doc', 'docx', 'txt', 'zip'],
        resource_type: 'auto'
    }
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

        const newPost = new Post({
            title: title || "Untitled Post",
            author: author || "Student User",
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

        post.comments.push({ text: text.trim(), author: author || "Student User" });
        await post.save();
        res.json({ success: true, comments: post.comments });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Code Execution Endpoint
app.post('/run-code', async (req, res) => {
    let { code, input, language } = req.body;
    if (!code) return res.status(400).json({ output: "Error: No code provided." });

    const uniqueId = Date.now();
    let sourceFile, compileCmd, runCmd, className = 'Main';

    if (language === 'java') {
        ['Main.java', 'Main.class'].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });

        const importMatches = code.match(/import\s+[\w\.]+;/g) || [];
        const importsStr = importMatches.join('\n');

        let cleanCode = code.replace(/import\s+[\w\.]+;/g, '').trim();

        if (/class\s+[A-Za-z0-9_$]+/.test(cleanCode)) {
            cleanCode = cleanCode.replace(/public\s+class\s+/, 'class ');
            cleanCode = cleanCode.replace(/class\s+[A-Za-z0-9_$]+/, 'public class Main');
            code = `${importsStr}\n${cleanCode}`;
        } else {
            code = `${importsStr}\npublic class Main {\n${cleanCode}\n}`;
        }

        sourceFile = 'Main.java';
        compileCmd = `javac Main.java`;
        runCmd = `java Main`;
    } else if (language === 'c') {
        sourceFile = `temp_${uniqueId}.c`;
        compileCmd = `gcc ${sourceFile} -o temp_${uniqueId}`;
        runCmd = `./temp_${uniqueId}`;
    } else if (language === 'cpp') {
        sourceFile = `temp_${uniqueId}.cpp`;
        compileCmd = `g++ ${sourceFile} -o temp_${uniqueId}`;
        runCmd = `./temp_${uniqueId}`;
    } else if (language === 'python') {
        sourceFile = `temp_${uniqueId}.py`;
        runCmd = `python3 ${sourceFile}`;
    } else if (language === 'javascript') {
        sourceFile = `temp_${uniqueId}.js`;
        runCmd = `node ${sourceFile}`;
    } else {
        return res.status(400).json({ output: "Error: Unsupported language." });
    }

    fs.writeFileSync(sourceFile, code);

    const executeBinary = () => {
        const child = exec(runCmd, { timeout: 5000 }, (runErr, stdout, stderr) => {
            if (fs.existsSync(sourceFile)) fs.unlinkSync(sourceFile);
            if (fs.existsSync(`${className}.class`)) fs.unlinkSync(`${className}.class`);
            const exeFile = `temp_${uniqueId}`;
            if (fs.existsSync(exeFile)) fs.unlinkSync(exeFile);

            let rawOutput = stdout || stderr || "Execution completed with no output.";

            if (input && stdout) {
                const inputLines = input.trim().split(/\r?\n/);
                let lineIndex = 0;

                const outputLines = stdout.split(/\r?\n/);
                const formattedLines = outputLines.map(line => {
                    if (/(:\s*|:\n|\?\s*)$/.test(line) || /(:\s*|\?\s*)/.test(line)) {
                        if (lineIndex < inputLines.length) {
                            return `${line}${inputLines[lineIndex++]}`;
                        }
                    }
                    return line;
                });

                rawOutput = formattedLines.join('\n');
            } else {
                rawOutput = stdout || stderr || "Execution completed with no output.";
            }

            res.json({ output: rawOutput });
        });

        if (input !== undefined && input !== null && input !== '') {
            child.stdin.write(input + "\n");
        }
        child.stdin.end();
    };

    if (compileCmd) {
        exec(compileCmd, (compErr, stdout, stderr) => {
            if (compErr) {
                if (fs.existsSync(sourceFile)) fs.unlinkSync(sourceFile);
                return res.json({ output: stderr || compErr.message });
            }
            executeBinary();
        });
    } else {
        executeBinary();
    }
});


app.listen(PORT, () => console.log(`Server running on port ${PORT}`));