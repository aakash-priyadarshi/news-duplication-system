#!/usr/bin/env node

// Debug script to check what's happening during startup
console.log('🐛 Debug: Starting application...');

try {
  // Load environment
  require('dotenv').config();
  console.log('✅ Environment loaded');

  // Test imports
  console.log('🔍 Testing imports...');
  
  const logger = require('./src/utils/logger');
  console.log('✅ Logger imported');
  
  const config = require('./src/config/config');
  console.log('✅ Config imported');
  
  const DatabaseManager = require('./src/services/DatabaseManager');
  console.log('✅ DatabaseManager imported');
  
  const NewsProcessor = require('./src/services/NewsProcessor');
  console.log('✅ NewsProcessor imported');
  
  const DeduplicationEngine = require('./src/services/DeduplicationEngine');
  console.log('✅ DeduplicationEngine imported');
  
  const AlertManager = require('./src/services/AlertManager');
  console.log('✅ AlertManager imported');
  
  const HealthChecker = require('./src/utils/healthcheck');
  console.log('✅ HealthChecker imported');
  
  // Test main app
  const NewsDeduplicationApp = require('./src/index');
  console.log('✅ Main app imported');
  
  console.log('🎉 All imports successful! Starting main application...');
  
  // Start the app
  const app = new NewsDeduplicationApp();
  app.start().catch((error) => {
    console.error('💥 App failed to start:', error);
    process.exit(1);
  });
  
} catch (error) {
  console.error('💥 Debug failed:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}