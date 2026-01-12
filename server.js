require('dotenv').config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
    },
    path: "/socket.io",
});

const Sentiment = require('sentiment');
const sentiment = new Sentiment();

const axios = require('axios');

// Enable CORS for all origins
app.use(cors());

// Add body parsing middleware for JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
app.post('/summarize', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const prompt = `Summarize the following text:\n\n${text}`;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                contents: [
                    {
                        parts: [{ text: prompt }]
                    }
                ]
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        let summary = text;
        if (response.data && Array.isArray(response.data.candidates) && response.data.candidates.length > 0) {
            const candidate = response.data.candidates[0];
            if (typeof candidate.content === 'string') {
                summary = candidate.content;
            } else if (typeof candidate.content === 'object' && Array.isArray(candidate.content.parts)) {
                summary = candidate.content.parts.map(part => part.text).join('');
            } else if (typeof candidate.content === 'object' && candidate.content.text) {
                summary = candidate.content.text;
            } else {
                summary = JSON.stringify(candidate.content);
            }
        }
        res.json({ summary });
    } catch (error) {
        console.error('Gemini API error:', error);
        res.status(500).json({ error: 'Failed to generate summary' });
    }
});

app.post('/translate', async (req, res) => {
    const { text, targetLanguage } = req.body;
    if (!text || !targetLanguage) return res.status(400).json({ error: 'Text and target language are required' });

    let prompt = `Translate the following text to ${targetLanguage}:\n\n${text}`;
    if (targetLanguage === 'hi') {
        prompt += "\n\nPlease provide a concise, natural-sounding translation without explanations or multiple options.";
    }

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                contents: [
                    {
                        parts: [{ text: prompt }]
                    }
                ]
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        let translation = text;
        if (response.data && Array.isArray(response.data.candidates) && response.data.candidates.length > 0) {
            const candidate = response.data.candidates[0];
            if (typeof candidate.content === 'string') {
                translation = candidate.content;
            } else if (typeof candidate.content === 'object' && Array.isArray(candidate.content.parts)) {
                translation = candidate.content.parts.map(part => part.text).join('');
            } else if (typeof candidate.content === 'object' && candidate.content.text) {
                translation = candidate.content.text;
            } else {
                translation = JSON.stringify(candidate.content);
            }
        }
        res.json({ translation });
    } catch (error) {
        console.error('Gemini API translation error:', error);
        res.status(500).json({ error: 'Failed to generate translation' });
    }
});

app.use(express.static(path.join(__dirname, 'client')));
mongoose.connect(process.env.MONGODB_URI, { family: 4 })
    .then(() => console.log("✅ MongoDB Connected"))
    .catch((err) => console.error("❌ MongoDB Error:", err));

const User = require('./models/User');

app.post('/register', async (req, res) => {
    const { username, password, dob, gender } = req.body;
    try {
        const exists = await User.findOne({ username });
        if (exists) return res.status(400).json({ error: "User already exists" });

        const newUser = new User({ username, password, dob, gender, contacts: [], messages: [] });
        await newUser.save();
        res.status(200).json({ message: "User registered" });
    } catch (err) {
        res.status(500).json({ error: "Server error during registration" });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });

    try {
        const user = await User.findOne({ username, password });
        if (!user) return res.status(401).json({ error: "Invalid username or password" });

        res.status(200).json({ message: "Login successful", username: user.username, token: "dummy-token" });
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
});

let clients = {}; // username -> [socketId1, socketId2, ...]

io.on("connection", (socket) => {
    console.log('🟢 New client connected', socket.id);
    let username = null;

    socket.on("connect-user", ({ username: u }) => {
        username = u;

        if (!clients[username]) {
            clients[username] = [];
        }
        if (!clients[username].includes(socket.id)) {
            clients[username].push(socket.id);
        }

        console.log(`[WebRTC SERVER] SUCCESS: connect-user received. Username: ${username}, SocketID: ${socket.id}`);
        
        broadcastUserList();
    });


    socket.on("message", async (data) => {
        // ... (existing message logic) ...
        const { sender, recipient, message } = data;

        /* ---------- Spam check ---------- */
        try {
            const response = await axios.post(
                process.env.SPAM_API_URL || 'https://chat-x-2-3-1.onrender.com/predict',
                { message }
            );

            if (response.data.prediction === 'spam') {
                socket.emit("error", "Message detected as spam or abuse and was blocked.");
                return;
            }
        } catch (err) {
            console.error("Spam detection API error:", err);
        }

        /* ---------- Sentiment ---------- */
        const timestamp = new Date();
        const result = sentiment.analyze(message);

        let mood = "neutral";
        if (result.score > 2) mood = "happy";
        else if (result.score < -2) mood = "sad";
        else if (result.score < 0) mood = "angry";

        const payload = {
            sender,
            recipient,
            message,
            timestamp: timestamp.toLocaleString(),
            mood
        };

        /* ---------- Save to MongoDB ---------- */
        try {
            // sender side
            await User.updateOne(
                { username: sender, "messages.with": recipient },
                {
                    $addToSet: { contacts: recipient },
                    $push: { "messages.$.chat": { sender, message, timestamp } }
                }
            );

            await User.updateOne(
                { username: sender, "messages.with": { $ne: recipient } },
                {
                    $addToSet: { contacts: recipient },
                    $push: {
                        messages: {
                            with: recipient,
                            chat: [{ sender, message, timestamp }]
                        }
                    }
                }
            );

            // recipient side
            await User.updateOne(
                { username: recipient, "messages.with": sender },
                {
                    $addToSet: { contacts: sender },
                    $push: { "messages.$.chat": { sender, message, timestamp } }
                }
            );

            await User.updateOne(
                { username: recipient, "messages.with": { $ne: sender } },
                {
                    $addToSet: { contacts: sender },
                    $push: {
                        messages: {
                            with: sender,
                            chat: [{ sender, message, timestamp }]
                        }
                    }
                }
            );
        } catch (err) {
            console.error("❌ MongoDB chat save error:", err);
        }

        /* ---------- Emit to recipient (SINGLE socket) ---------- */
        const recipientSockets = clients[recipient];
        if (recipientSockets && recipientSockets.length > 0) {
            recipientSockets.forEach(socketId => {
                io.to(socketId).emit("message", payload);
            });
        }    });


    socket.on("typing", ({ sender, recipient }) => {
        const recipientSockets = clients[recipient];
        if (recipientSockets && recipientSockets.length > 0) {
            recipientSockets.forEach(socketId => {
                io.to(socketId).emit("typing", { sender });
            });
        }
    });


    socket.on("join-room", ({ room, initiator }) => {
        console.log(`[WebRTC SERVER] SUCCESS: join-room received. Room: ${room}, SocketID: ${socket.id}`);
        
        socket.join(room);
        
        const clientsInRoom = io.sockets.adapter.rooms.get(room);
        const numClients = clientsInRoom ? clientsInRoom.size : 0;
        
        // Always notify others in the room
        socket.to(room).emit("peer-joined", { peerId: socket.id, initiator });
        console.log(`[WebRTC SERVER] SUCCESS: peer-joined emitted. Room: ${room}, Target: OTHER peers`);
        
        // Notify the user who just joined
        socket.emit("room-joined", { room, numClients });
        console.log(`[WebRTC SERVER] SUCCESS: room-joined emitted. Room: ${room}, Target: ${socket.id}`);
    });

    socket.on("signal", ({ signal, room }) => {
        const type = signal.type || (signal.candidate ? "candidate" : "unknown");
        console.log(`[WebRTC SERVER] SUCCESS: signal received. Type: ${type}, Room: ${room}`);
        socket.to(room).emit("signal", { signal });
        console.log(`[WebRTC SERVER] SUCCESS: signal relayed. Room: ${room}`);
    });

    socket.on("call-offer", ({ to, from, type }) => {
        console.log(`[WebRTC SERVER] SUCCESS: call-offer received. From: ${from}, To: ${to}`);
        
        // Acknowledge receipt to the sender
        socket.emit("call-offer-ack", { status: "received", recipient: to });

        const recipientSockets = clients[to];

        if (recipientSockets && recipientSockets.length > 0) {
            recipientSockets.forEach(socketId => {
                io.to(socketId).emit("call-offer", { from, type });
                console.log(`[WebRTC SERVER] SUCCESS: call-offer relayed. Target SocketID: ${socketId}`);
            });
        } else {
            console.log(`[WebRTC SERVER] FAIL: call-offer relay failed. Recipient '${to}' not found.`);
        }
    });

    socket.on("call-accepted", ({ to }) => {
        console.log(`✅ call accepted by ${username}, notifying ${to}`);

        const recipientSockets = clients[to];
        if (recipientSockets && recipientSockets.length > 0) {
            recipientSockets.forEach(socketId => {
                io.to(socketId).emit("call-accepted", { from: username });
            });
        }
    });


    socket.on("call-rejected", ({ to, reason }) => {
        console.log(`❌ call rejected by ${username}, reason: ${reason}`);

        const recipientSockets = clients[to];
        if (recipientSockets && recipientSockets.length > 0) {
            recipientSockets.forEach(socketId => {
                io.to(socketId).emit("call-rejected", {
                    from: username,
                    reason
                });
            });
        }
    });


    socket.on("call-ended", ({ to }) => {
        console.log(`📴 call ended by ${username}`);

        const recipientSockets = clients[to];
        if (recipientSockets && recipientSockets.length > 0) {
            recipientSockets.forEach(socketId => {
                io.to(socketId).emit("call-ended", { from: username });
            });
        }
    });



    socket.on("disconnect", () => {
        if (username && clients[username]) {
            clients[username] = clients[username].filter(id => id !== socket.id);
            if (clients[username].length === 0) {
                delete clients[username];
            }
            console.log(`🔴 ${username} disconnected from socket ${socket.id}`);
            broadcastUserList();
        }
    });
});

function broadcastUserList() {
    const users = Object.keys(clients);
    console.log(`Broadcasting user list: ${users}`);
    io.emit("updateUsers", users);
}

app.get('/history', async (req, res) => {
    const { user, peer } = req.query;
    if (!user || !peer) return res.status(400).json({ error: "Missing user or peer" });

    try {
        const currentUser = await User.findOne({ username: user });
        if (!currentUser) return res.status(404).json({ error: "User not found" });

        const history = currentUser.messages.find(entry => entry.with === peer);
        if (!history) return res.json([]);

        res.json(history.chat);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch chat history" });
    }
});

app.get('/version', (req, res) => {
    res.json({ version: '2.4.1-debug', message: 'If you see this, the new server.js is running!' });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server (HTTP + Socket.IO) running on port ${PORT}`);
});
