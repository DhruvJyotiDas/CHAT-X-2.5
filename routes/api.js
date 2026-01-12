const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');

const GEMINI_API_KEY = 'AIzaSyBWSUg8x3ljYqXabdHLMyzJSZeAuDWmIgk';

module.exports = function (upload, groups) {
  router.post('/summarize', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const prompt = `Summarize the following text:\n\n${text}`;

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        },
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );

      let summary = text;
      if (
        response.data &&
        Array.isArray(response.data.candidates) &&
        response.data.candidates.length > 0
      ) {
        const candidate = response.data.candidates[0];
        if (typeof candidate.content === 'string') {
          summary = candidate.content;
        } else if (
          typeof candidate.content === 'object' &&
          Array.isArray(candidate.content.parts)
        ) {
          summary = candidate.content.parts.map((part) => part.text).join('');
        } else if (
          typeof candidate.content === 'object' &&
          candidate.content.text
        ) {
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

  router.post('/translate', async (req, res) => {
    const { text, targetLanguage } = req.body;
    if (!text || !targetLanguage)
      return res
        .status(400)
        .json({ error: 'Text and target language are required' });

    let prompt = `Translate the following text to ${targetLanguage}:\n\n${text}`;
    if (targetLanguage === 'hi') {
      prompt +=
        '\n\nPlease provide a concise, natural-sounding translation without explanations or multiple options.';
    }

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        },
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );

      let translation = text;
      if (
        response.data &&
        Array.isArray(response.data.candidates) &&
        response.data.candidates.length > 0
      ) {
        const candidate = response.data.candidates[0];
        if (typeof candidate.content === 'string') {
          translation = candidate.content;
        } else if (
          typeof candidate.content === 'object' &&
          Array.isArray(candidate.content.parts)
        ) {
          translation = candidate.content.parts
            .map((part) => part.text)
            .join('');
        } else if (
          typeof candidate.content === 'object' &&
          candidate.content.text
        ) {
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

  router.post(
    '/api/upload-avatar',
    upload.single('avatar'),
    async (req, res) => {
      if (!req.file) {
        return res.status(400).send('No file uploaded.');
      }

      const username = req.body.username;
      const avatarUrl = `uploads/${req.file.filename}`;

      try {
        await User.updateOne({ username: username }, { avatar: avatarUrl });
        res.status(200).json({ avatarUrl: avatarUrl });
      } catch {
        res.status(500).json({ error: 'Server error during avatar upload' });
      }
    }
  );

  router.post('/register', async (req, res) => {
    const { username, password, dob, gender } = req.body;
    try {
      const exists = await User.findOne({ username });
      if (exists) return res.status(400).json({ error: 'User already exists' });

      const newUser = new User({
        username,
        password,
        dob,
        gender,
        contacts: [],
        messages: [],
      });
      await newUser.save();
      res.status(200).json({ message: 'User registered' });
    } catch {
      res.status(500).json({ error: 'Server error during registration' });
    }
  });

  router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });

    try {
      const user = await User.findOne({ username, password });
      if (!user)
        return res.status(401).json({ error: 'Invalid username or password' });

      res.status(200).json({
        message: 'Login successful',
        username: user.username,
        token: 'dummy-token',
      });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/history', async (req, res) => {
    const { user, peer } = req.query;
    if (!user || !peer)
      return res.status(400).json({ error: 'Missing user or peer' });

    try {
      const currentUser = await User.findOne({ username: user });
      if (!currentUser)
        return res.status(404).json({ error: 'User not found' });

      const history = currentUser.messages.find((entry) => entry.with === peer);
      if (!history) return res.json([]);

      res.json(history.chat);
    } catch {
      res.status(500).json({ error: 'Failed to fetch chat history' });
    }
  });

  router.post('/api/create-group', async (req, res) => {
    const { groupName, username } = req.body;
    if (!groupName || !username) {
      return res
        .status(400)
        .json({ error: 'Group name and username are required' });
    }

    const groupId = `group-${Date.now()}`;
    groups[groupId] = [username];

    try {
      // You might want to save groups in the database as well
      res.status(200).json({ message: 'Group created', groupId });
      // broadcastUserAndGroupList is not available here.
      // This should be handled in the main server file.
    } catch {
      res.status(500).json({ error: 'Server error during group creation' });
    }
  });

  router.post('/api/join-group', async (req, res) => {
    const { groupId, username } = req.body;
    if (!groupId || !username) {
      return res
        .status(400)
        .json({ error: 'Group ID and username are required' });
    }

    if (!groups[groupId]) {
      return res.status(404).json({ error: 'Group not found' });
    }

    if (!groups[groupId].includes(username)) {
      groups[groupId].push(username);
    }

    try {
      res.status(200).json({ message: 'Joined group' });
      // broadcastUserAndGroupList is not available here.
      // This should be handled in the main server file.
    } catch {
      res.status(500).json({ error: 'Server error during group joining' });
    }
  });

  return router;
};
