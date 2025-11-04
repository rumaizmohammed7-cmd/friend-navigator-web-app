const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const connectDB = require('./config/database');
const User = require('./models/User');
const Group = require('./models/Group');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Connect to MongoDB
connectDB();

// API Routes
app.get('/api/groups', async (req, res) => {
  try {
    const groups = await Group.find({ isActive: true });
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/groups', async (req, res) => {
  try {
    const { groupName, createdBy } = req.body;
    const groupId = `GRP-${Date.now()}`;
    
    const group = new Group({
      groupId,
      groupName,
      createdBy,
      members: [{ username: createdBy, joinedAt: new Date() }]
    });
    
    await group.save();
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/groups/:groupId/join', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { username } = req.body;
    
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    const existingMember = group.members.find(m => m.username === username);
    if (!existingMember) {
      group.members.push({ username, joinedAt: new Date() });
      await group.save();
    }
    
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/groups/:groupId/destination', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { latitude, longitude, address } = req.body;
    
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    group.destination = { latitude, longitude, address };
    await group.save();
    
    // Notify all members
    io.to(groupId).emit('destinationSet', group.destination);
    
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/groups/:groupId/destination', async (req, res) => {
  try {
    const { groupId } = req.params;
    
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    // Clear destination from group
    group.destination = null;
    await group.save();
    
    // Clear destination from all users in the group
    await User.updateMany(
      { groupId },
      { $unset: { destination: 1 } }
    );
    
    // Notify all members to clear destination
    io.to(groupId).emit('destinationCleared');
    
    res.json({ message: 'Destination cleared successfully', group });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    const users = await User.find({ groupId, isOnline: true });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.IO Real-time Communication
io.on('connection', (socket) => {
  console.log('👤 User connected:', socket.id);
  
  // User joins a group
  socket.on('joinGroup', async (data) => {
    const { username, groupId } = data;
    socket.join(groupId);
    
    // Update or create user
    let user = await User.findOne({ username, groupId });
    if (!user) {
      user = new User({ username, groupId, socketId: socket.id, isOnline: true });
    } else {
      user.isOnline = true;
      user.socketId = socket.id;
    }
    await user.save();
    
    // Get group information with destination
    const group = await Group.findOne({ groupId });
    
    // Send complete group state to the new joiner
    const groupUsers = await User.find({ groupId, isOnline: true });
    
    // Send group data including destination and all members
    socket.emit('groupState', {
      group: group,
      members: groupUsers,
      destination: group?.destination || null
    });
    
    // Notify OTHER group members that new user joined
    socket.to(groupId).emit('userJoined', { username, groupId });
    
    // If this user has location, broadcast it to the group
    if (user.currentLocation && user.currentLocation.latitude) {
      io.to(groupId).emit('memberLocationUpdate', {
        username: user.username,
        latitude: user.currentLocation.latitude,
        longitude: user.currentLocation.longitude,
        eta: user.eta,
        timestamp: user.currentLocation.timestamp
      });
    }
    
    console.log(`✅ ${username} joined group ${groupId}`);
  });
  
  // Location update
  socket.on('locationUpdate', async (data) => {
    const { username, groupId, latitude, longitude, eta } = data;
    
    const user = await User.findOne({ username, groupId });
    if (user) {
      user.currentLocation = { latitude, longitude, timestamp: new Date() };
      if (eta !== undefined) user.eta = eta;
      await user.save();
      
      // Broadcast to group
      io.to(groupId).emit('memberLocationUpdate', {
        username,
        latitude,
        longitude,
        eta,
        timestamp: new Date()
      });
    }
  });
  
  // Route deviation alert
  socket.on('routeDeviation', async (data) => {
    const { username, groupId } = data;
    
    const user = await User.findOne({ username, groupId });
    if (user) {
      user.routeDeviated = true;
      await user.save();
      
      io.to(groupId).emit('alert', {
        type: 'route_deviation',
        message: `${username} has taken a different route!`,
        username
      });
    }
  });
  
  // Delay alert
  socket.on('delayAlert', (data) => {
    const { username, groupId, delayMinutes } = data;
    
    io.to(groupId).emit('alert', {
      type: 'delay',
      message: `${username} is delayed by approximately ${delayMinutes} minutes`,
      username,
      delayMinutes
    });
  });
  
  // Set destination for group
  socket.on('setDestination', async (data) => {
    const { groupId, latitude, longitude, address } = data;
    
    const group = await Group.findOne({ groupId });
    if (group) {
      group.destination = { latitude, longitude, address };
      await group.save();
      
      io.to(groupId).emit('destinationSet', { latitude, longitude, address });
    }
  });
  
  // Disconnect
  socket.on('disconnect', async () => {
    const user = await User.findOne({ socketId: socket.id });
    if (user) {
      user.isOnline = false;
      await user.save();
      
      io.to(user.groupId).emit('userLeft', { username: user.username });
      console.log(`👋 ${user.username} left the group`);
    }
    console.log('🔌 User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (process.env.NODE_ENV === 'production') {
    console.log('🌐 Production URL: https://friend-navigator-web-app.onrender.com');
  } else {
    console.log(`🌐 Local URL: http://localhost:${PORT}`);
  }
});
