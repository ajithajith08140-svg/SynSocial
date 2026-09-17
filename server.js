const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { exec } = require('child_process');
require('dotenv').config();

const app = express();

// 1. Core Middlewares
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Ensure Uploads Directory Exists & Static Server
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 3. Port & MongoDB Connection Setup
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://RayeesaF:RayeesaF@cluster0.y50j1a9.mongodb.net/synsocial?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB Connected Successfully!"))
    .catch(err => console.error("MongoDB Connection Error:", err));

// 4. Mongoose Schema Definition
const postSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: { type: String, required: true },
    tag: { type: String, required: true },
    pin: { type: String, required: true },
    pinHint: { type: String, required: true },
    content: { type: String, required: true },
    link: { type: String, default: "" },
    code: { type: String, default: "" },
    docUrl: { type: String, default: "" },
    docName: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', postSchema);

// 5. Configure Multer Storage
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

// 6. API Endpoints

// Health Check Endpoint
app.get('/', (req, res) => {
    res.send("Synsocial API Server is running!");
});

// C Code Execution Endpoint (with Stdin Support for scanf)
// C Code Execution Endpoint (with Stdin Support for scanf)
app.post('/run-c', (req, res) => {
    const { code, input } = req.body;

    if (!code) {
        return res.status(400).json({ output: "Error: No code provided." });
    }

    // Dynamic unique filename to prevent collisions between multiple users
    const uniqueId = Date.now() + '_' + Math.floor(Math.random() * 1000);
    const sourceFile = `temp_${uniqueId}.c`;
    const outputFile = `temp_${uniqueId}`;

    // Helper function to cleanup temporary files from disk
    const cleanupFiles = () => {
        if (fs.existsSync(sourceFile)) fs.unlinkSync(sourceFile);
        if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    };

    // 1. Write user code to temporary file
    fs.writeFileSync(sourceFile, code);

    // 2. GCC compiler call
    exec(`gcc ${sourceFile} -o ${outputFile}`, (compileErr, stdout, stderr) => {
        if (compileErr) {
            cleanupFiles();
            return res.json({ output: stderr || compileErr.message });
        }

        // 3. Execution with 3-second Timeout (Prevents infinite loops)
        const child = exec(`./${outputFile}`, { timeout: 3000 }, (runErr, runStdout, runStderr) => {
            cleanupFiles(); // Clean up binary and C file after completion

            if (runErr && runErr.killed) {
                return res.json({ 
                    output: "Execution Timed Out! (Check if inputs are missing in stdin or if there is an infinite loop)." 
                });
            }
            res.json({ output: runStdout || runStderr || "Execution completed with no output." });
        });

        // 4. Pass stdin inputs and close stream immediately (EOF Signal)
        if (input) {
            child.stdin.write(input + "\n");
        }
        child.stdin.end(); // Stops scanf/cin from hanging indefinitely
    });
});
// Create Post and Save to MongoDB
app.post('/api/posts/create', upload.single('document'), async (req, res) => {
    try {
        const { title, author, tag, pin, pinHint, content, link, code } = req.body;

        let docUrl = "";
        let docName = "";

        if (req.file) {
            docUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
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

// Fetch All Posts
app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ createdAt: -1 });
        res.json(posts);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});