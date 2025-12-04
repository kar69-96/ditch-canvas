const { Browserbase } = require('@browserbasehq/sdk');
const https = require('https');
const { getBrowserbaseConfig } = require('./config');

function createBrowserbaseClient(options = {}) {
  const config = getBrowserbaseConfig(options);
  
  // Create HTTPS agent with proper SSL/TLS configuration
  // This helps resolve SSL certificate and protocol issues
  const httpsAgent = new https.Agent({
    keepAlive: true,
    // Allow newer TLS versions (TLS 1.2, 1.3)
    secureProtocol: 'TLSv1_2_method',
    // Standard SSL settings
    rejectUnauthorized: true,
  });
  
  return {
    client: new Browserbase({ 
      apiKey: config.apiKey,
      httpAgent: httpsAgent,
      // Increase timeout for connection issues
      timeout: 60000, // 60 seconds
    }),
    config,
  };
}

module.exports = {
  createBrowserbaseClient,
};
