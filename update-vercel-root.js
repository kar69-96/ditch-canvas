#!/usr/bin/env node
// Script to update Vercel project root directory via API
const { execSync } = require('child_process');

const PROJECT_ID = 'prj_cvxCpUSeAm9XvUHkfsVhLDFZ4e0l';
const TEAM_ID = 'team_KF1zgAuYxiRx0Li51iMZtaVg';

try {
  // Get token from Vercel CLI
  const token = execSync('vercel whoami --token', { encoding: 'utf8' }).trim();
  
  if (!token) {
    console.error('❌ Could not get Vercel token');
    process.exit(1);
  }

  console.log('🔄 Updating Vercel project root directory...');
  
  // Update project settings via API
  const https = require('https');
  const data = JSON.stringify({
    rootDirectory: null  // Clear root directory (use repo root)
  });

  const options = {
    hostname: 'api.vercel.com',
    path: `/v9/projects/${PROJECT_ID}?teamId=${TEAM_ID}`,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = https.request(options, (res) => {
    let responseData = '';
    
    res.on('data', (chunk) => {
      responseData += chunk;
    });
    
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('✅ Successfully updated root directory!');
        console.log(JSON.parse(responseData));
      } else {
        console.error('❌ Failed to update:', res.statusCode);
        console.error(responseData);
        process.exit(1);
      }
    });
  });

  req.on('error', (error) => {
    console.error('❌ Request error:', error);
    process.exit(1);
  });

  req.write(data);
  req.end();
  
} catch (error) {
  console.error('❌ Error:', error.message);
  console.log('\n📝 Alternative: Update root directory manually at:');
  console.log('   https://vercel.com/kar69-96s-projects/ditch-canvas/settings');
  process.exit(1);
}

