const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { exec } = require('child_process');
const axios = require('axios');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 1. MONGODB CONNECTION & DOCUMENT SCHEMA
// ==========================================
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/myAppDatabase';

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Connected to MongoDB successfully!');
}).catch(err => {
    console.error('MongoDB connection error:', err.message);
});

// Document Schema for storing files directly in MongoDB (Up to 16MB per file)
const documentSchema = new mongoose.Schema({
    filename: String,
    contentType: String, // e.g., 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    data: Buffer,        // Binary buffer data
    createdAt: { type: Date, default: Date.now }
});
const Document = mongoose.model('Document', documentSchema);

// Multer setup using memoryStorage (keeps file in RAM temporarily to save directly to MongoDB)
const upload = multer({ storage: multer.memoryStorage() });


// ==========================================
// 2. DOCUMENT UPLOAD & RETRIEVAL ROUTES (MongoDB)
// ==========================================

// Upload Route
app.post('/api/upload-doc', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const newDoc = new Document({
            filename: req.file.originalname,
            contentType: req.file.mimetype,
            data: req.file.buffer
        });

        await newDoc.save();
        res.json({ 
            message: 'Document uploaded successfully to MongoDB!', 
            fileId: newDoc._id,
            filename: newDoc.filename 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Retrieve / View / Download Route
app.get('/api/get-doc/:id', async (req, res) => {
    try {
        const doc = await Document.findById(req.params.id);
        if (!doc) {
            return res.status(404).json({ error: 'Document not found in database' });
        }

        res.setHeader('Content-Type', doc.contentType);
        res.setHeader('Content-Disposition', `inline; filename="${doc.filename}"`);
        res.send(doc.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ==========================================
// 3. CODE EXECUTION ROUTE (JS, Python, C, C++ & Java)
// ==========================================
app.post('/api/run-code', async (req, res) => {
    let { language, code, stdin } = req.body;
    const lang = (language || '').toLowerCase().trim();
    
    // Handle Java using public execution endpoint (No API key or subscription needed)
    if (lang.includes('java')) {
        try {
            const response = await axios.post('https://emkc.org/api/v2/piston/execute', {
                language: 'java',
                version: '*',
                files: [{ content: code }],
                stdin: stdin || ''
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            });
            
            return res.json({
                run: {
                    output: response.data.run.output || '',
                    stderr: response.data.run.stderr || ''
                }
            });
        } catch (err) {
            return res.json({
                run: {
                    output: '',
                    stderr: 'Java Execution Notice: Public execution servers are busy. Please try again or test locally.'
                }
            });
        }
    }

    // Native execution for Python, JavaScript, C, and C++ on Render
    const tmpDir = path.join(__dirname, 'tmp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    const uniqueId = Date.now() + Math.random().toString(36).substring(2, 7);
    let fileName = '';
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
    } else {
        return res.json({ run: { output: '', stderr: 'Unsupported language selected.' } });
    }

    const filePath = path.join(tmpDir, fileName);

    const child = exec(cmd, { timeout: 8000 }, (error, stdout, stderr) => {
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            exec(`rm -f ${path.join(tmpDir, '*.class')} ${path.join(tmpDir, 'exec_*')}`);
        } catch (e) {}

        res.json({
            run: {
                output: stdout || '',
                stderr: stderr || (error ? error.message : '')
            }
        });
    });

    if (stdin) {
        child.stdin.write(stdin);
        child.stdin.end();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});