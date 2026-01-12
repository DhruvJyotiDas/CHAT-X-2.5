const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  contacts: [String], // usernames
  messages: [{
    with: String,
    chat: [{
      sender: String,
      message: String,
      timestamp: Date
    }]
  }]
});

module.exports = mongoose.model('User', userSchema);
