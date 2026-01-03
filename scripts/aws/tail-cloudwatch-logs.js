#!/usr/bin/env node
/**
 * Tail CloudWatch Logs for AWS Update Process
 * Streams logs in real-time from CloudWatch
 */

const { streamLogs, listLogStreams, LOG_GROUP_NAME, LOG_STREAM_PREFIX } = require('./utils/cloudwatch-logs.js');

async function main() {
  const args = process.argv.slice(2);
  const streamName = args[0];
  const follow = !args.includes('--no-follow');

  console.log('🔍 CloudWatch Logs Tail');
  console.log('='.repeat(60));
  console.log(`   Log Group: ${LOG_GROUP_NAME}`);
  console.log('='.repeat(60));
  console.log('');

  if (!streamName) {
    // List recent streams
    console.log('📋 Recent log streams:');
    console.log('');
    
    try {
      const streams = await listLogStreams(10);
      
      if (streams.length === 0) {
        console.log('   No log streams found');
        console.log('');
        console.log('   Usage: node tail-cloudwatch-logs.js <stream-name>');
        console.log('   Example: node tail-cloudwatch-logs.js 2025-12-24-19-12-00');
        process.exit(0);
      }

      streams.forEach((stream, index) => {
        const name = stream.logStreamName.replace(`${LOG_STREAM_PREFIX}-`, '');
        const lastEvent = stream.lastEventTime 
          ? new Date(stream.lastEventTime).toISOString()
          : 'No events';
        console.log(`   ${index + 1}. ${name}`);
        console.log(`      Last event: ${lastEvent}`);
        console.log('');
      });

      console.log('   Usage: node tail-cloudwatch-logs.js <stream-name>');
      console.log('   Example: node tail-cloudwatch-logs.js 2025-12-24-19-12-00');
      console.log('');
      console.log('   Or use the most recent:');
      if (streams.length > 0) {
        const mostRecent = streams[0].logStreamName.replace(`${LOG_STREAM_PREFIX}-`, '');
        console.log(`   node tail-cloudwatch-logs.js ${mostRecent}`);
      }
    } catch (error) {
      console.error('❌ Error listing log streams:', error.message);
      process.exit(1);
    }
    
    process.exit(0);
  }

  console.log(`📡 Streaming logs from: ${streamName}`);
  if (follow) {
    console.log('   (Press Ctrl+C to stop)');
  }
  console.log('');

  try {
    await streamLogs(streamName, null, follow);
  } catch (error) {
    console.error('❌ Error streaming logs:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };




