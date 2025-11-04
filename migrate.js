// Migration script to fix MongoDB indexes
const mongoose = require('mongoose');
require('dotenv').config();

async function migrateIndexes() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('✅ Connected to MongoDB');
    
    // Drop the old username unique index
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    
    try {
      await usersCollection.dropIndex('username_1');
      console.log('✅ Dropped old username_1 index');
    } catch (error) {
      console.log('⚠️ Index username_1 does not exist or already dropped');
    }
    
    // Create the new compound index
    await usersCollection.createIndex({ username: 1, groupId: 1 }, { unique: true });
    console.log('✅ Created compound index on username and groupId');
    
    console.log('✅ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateIndexes();
