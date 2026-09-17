const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: { type: String, required: true },
    tag: { type: String },
    pin: { type: String },
    pinHint: { type: String },
    content: { type: String },
    link: { type: String },
    code: { type: String },
    docUrl: { type: String },   // Path to uploaded file
    docName: { type: String },  // Original file name
    likes: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Post', postSchema);