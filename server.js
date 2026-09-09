const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Uploads Folder Static Middleware
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

// Multer Disk Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// 1. Database Connection (MongoDB Cloud)
const MONGO_URI = "mongodb+srv://Rayeesa:Rayeesa123@cluster0.y50j1a9.mongodb.net/synsocial_db?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB Atlas Cloud DB Connected Successfully!"))
  .catch(err => console.log("DB Connection Note: Running API fallback mode"));

// 2. Data Schema Definition
const postSchema = new mongoose.Schema({
  author: { type: String, required: true },
  content: { type: String, required: true },
  codeSnippet: { type: String, default: "" },
  resourceLink: { type: String, default: "" },
  filePath: { type: String, default: "" }, // <--- File Upload Path Field
  likes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', postSchema);

let memoryPosts = [];

// 3. API Endpoints

// GET All Posts
app.get('/api/posts', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const posts = await Post.find().sort({ createdAt: -1 });
      return res.json(posts);
    }
    res.json(memoryPosts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST New Post (With Multer Middleware)
app.post('/api/posts', upload.single('file'), async (req, res) => {
  try {
    const { author, content, codeSnippet, resourceLink } = req.body;
    const filePath = req.file ? `uploads/${req.file.filename}` : "";

    if (mongoose.connection.readyState === 1) {
      const newPost = new Post({ 
        author, 
        content, 
        codeSnippet, 
        resourceLink,
        filePath 
      });
      await newPost.save();
      return res.status(201).json(newPost);
    }

    const newMemoryPost = {
      _id: Date.now().toString(),
      author: author || "Rayeesa",
      content,
      codeSnippet: codeSnippet || "",
      resourceLink: resourceLink || "",
      filePath: filePath,
      likes: 0,
      createdAt: new Date()
    };
    memoryPosts.unshift(newMemoryPost);
    res.status(201).json(newMemoryPost);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT Like Post
app.put('/api/posts/:id/like', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const post = await Post.findById(req.params.id);
      post.likes += 1;
      await post.save();
      return res.json(post);
    }

    const post = memoryPosts.find(p => p._id === req.params.id);
    if (post) {
      post.likes += 1;
      return res.json(post);
    }
    res.status(404).json({ error: "Post not found" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE Post
app.delete('/api/posts/:id', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      await Post.findByIdAndDelete(req.params.id);
      return res.json({ message: "Post deleted successfully" });
    }

    memoryPosts = memoryPosts.filter(p => p._id !== req.params.id);
    res.json({ message: "Post deleted from memory" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
const PORT = 5000;
app.listen(PORT, () => console.log(`SynSocial Server running on http://localhost:${PORT}`));