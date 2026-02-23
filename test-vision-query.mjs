#!/usr/bin/env node

// Test script for vision query functionality
const { invoke } = require('@tauri-apps/api/core');

async function testVisionQuery() {
  try {
    console.log('Testing vision query for people in last 10 minutes...');
    
    const result = await invoke('vision_query', {
      question: 'Ile osób było w pomieszczeniu w ostatnich 10 minutach',
      dbPath: 'monitoring.db'
    });
    
    console.log('Query result:', JSON.stringify(result, null, 2));
    
    if (result.row_count === 0) {
      console.log('\nNo detections found in the last 10 minutes.');
      console.log('This could mean:');
      console.log('1. No monitoring pipeline is running');
      console.log('2. No camera is configured');
      console.log('3. No people were detected');
      console.log('4. The database does not exist yet');
    } else {
      console.log(`\nFound ${result.row_count} detection(s) in the last 10 minutes`);
    }
    
  } catch (error) {
    console.error('Error executing vision query:', error);
    
    if (error.includes('Cannot open monitoring DB')) {
      console.log('\nMonitoring database not found. This is expected if:');
      console.log('- No vision pipeline has been run yet');
      console.log('- The system is not configured for monitoring');
    }
  }
}

if (require.main === module) {
  testVisionQuery();
}

module.exports = { testVisionQuery };
