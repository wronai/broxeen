#!/usr/bin/env node

// Create sample monitoring data for testing
const fs = require('fs');
const path = require('path');

// Simple SQLite database creation (without external dependencies)
function createSampleDatabase() {
  const dbPath = path.join(process.cwd(), 'src-tauri', 'monitoring.db');
  
  // Check if database already exists
  if (fs.existsSync(dbPath)) {
    console.log('Database already exists at:', dbPath);
    return;
  }
  
  console.log('Creating sample monitoring database at:', dbPath);
  
  // For now, we'll create a placeholder - the actual database will be created
  // by the Rust vision pipeline when it runs
  console.log('\nNote: The actual database will be created by the vision pipeline.');
  console.log('To test the query functionality:');
  console.log('1. Set up a camera with RTSP stream');
  console.log('2. Run: monitoruj <rtsp_url>');
  console.log('3. Wait for some detections to occur');
  console.log('4. Then ask: "Ile osób było w pomieszczeniu w ostatnich 10 minutach"');
}

if (require.main === module) {
  createSampleDatabase();
}

module.exports = { createSampleDatabase };
