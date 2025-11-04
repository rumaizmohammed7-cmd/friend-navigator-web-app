const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true
  },
  groupId: {
    type: String,
    required: true
  },
  currentLocation: {
    latitude: Number,
    longitude: Number,
    timestamp: Date
  },
  destination: {
    latitude: Number,
    longitude: Number,
    address: String
  },
  eta: Number,
  isOnline: {
    type: Boolean,
    default: false
  },
  routeDeviated: {
    type: Boolean,
    default: false
  },
  socketId: String
}, { timestamps: true });

// Compound unique index: username must be unique within a group
userSchema.index({ username: 1, groupId: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
