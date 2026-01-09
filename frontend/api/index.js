// Vercel serverless function entry point
const path = require('path');

// Set up environment
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// Import the Express app
const app = require('../server.js');

// Export for Vercel
module.exports = app;
