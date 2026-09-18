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

// Universal Multi-Language Code Execution Endpoint
app.post('/run-code', async (req, res) => {
    let { code, input, language } = req.body;

    if (!code) {
        return res.status(400).json({ output: "Error: No code provided." });
    }

    // Java Execution via Judge0 Free API
    if (language === 'java') {
        try {
            let processedCode = code;

            // Remove 'public' modifier from class definitions to allow class Main rename
            processedCode = processedCode.replace(/public\s+class\s+([A-Za-z0-9_]+)/g, 'class $1');

            // Automatically rename whatever main class name the user typed to 'Main'
            if (!processedCode.includes('class Main')) {
                processedCode = processedCode.replace(/class\s+([A-Za-z0-9_]+)/g, 'class Main');
            }

            const response = await fetch('https://ce.judge0.com/submissions?wait=true', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json' 
                },
                body: JSON.stringify({
                    language_id: 62, // Java (OpenJDK 13.0.1)
                    source_code: processedCode,
                    stdin: input || ""
                })
            });

            const data = await response.json();
            const outputResult = data.stdout || data.compile_output || data.stderr || data.message || "Execution completed with no output.";
            return res.json({ output: outputResult });

        } catch (error) {
            return res.json({ output: "Java Execution API Error: " + error.message });
        }
    }

    // Local Execution for C, C++, Python, JavaScript
    const uniqueId = Date.now() + '_' + Math.floor(Math.random() * 1000);
    let sourceFile, compileCmd, runCmd;

    if (language === 'cpp' || language === 'cpp17') {
        sourceFile = `temp_${uniqueId}.cpp`;
        const outputFile = `temp_${uniqueId}`;
        compileCmd = `g++ ${sourceFile} -o ${outputFile}`;
        runCmd = `./${outputFile}`;
    } else if (language === 'c') {
        sourceFile = `temp_${uniqueId}.c`;
        const outputFile = `temp_${uniqueId}`;
        compileCmd = `gcc ${sourceFile} -o ${outputFile}`;
        runCmd = `./${outputFile}`;
    } else if (language === 'python') {
        sourceFile = `temp_${uniqueId}.py`;
        compileCmd = null;
        runCmd = `python3 ${sourceFile}`;
    } else if (language === 'javascript') {
        sourceFile = `temp_${uniqueId}.js`;
        compileCmd = null;
        runCmd = `node ${sourceFile}`;

        // Node.js-la prompt() support panna custom polyfill logic
        const promptPolyfill = `
const fs = require('fs');
let _stdinInputs = [];
let _stdinIndex = 0;

try {
    _stdinInputs = fs.readFileSync(0, 'utf-8').trim().split(/\\r?\\n/);
} catch(e) {}

function prompt(message) {
    if (message) process.stdout.write(message + "\\n");
    if (_stdinIndex < _stdinInputs.length) {
        return _stdinInputs[_stdinIndex++];
    }
    return "";
}
\n`;
        code = promptPolyfill + code;
    } else {
        return res.status(400).json({ output: "Error: Unsupported language." });
    }

    const cleanupFiles = () => {
        if (fs.existsSync(sourceFile)) fs.unlinkSync(sourceFile);
        if (language === 'c' || language === 'cpp' || language === 'cpp17') {
            const outputFile = `temp_${uniqueId}`;
            if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
        }
    };

    fs.writeFileSync(sourceFile, code);

    const executeBinary = () => {
        const child = exec(runCmd, { timeout: 3000 }, (runErr, runStdout, runStderr) => {
            cleanupFiles();
            if (runErr && runErr.killed) {
                return res.json({ output: "Execution Timed Out! (Check missing inputs or infinite loops)." });
            }
            res.json({ output: runStdout || runStderr || "Execution completed with no output." });
        });

        if (input) {
            child.stdin.write(input + "\n");
        }
        child.stdin.end();
    };

    if (compileCmd) {
        exec(compileCmd, (compileErr, stdout, stderr) => {
            if (compileErr) {
                cleanupFiles();
                return res.json({ output: stderr || compileErr.message });
            }
            executeBinary();
        });
    } else {
        executeBinary();
    }
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