# CloudWatch Logs Monitoring Guide

## Overview

The AWS update process now automatically sends all logs to CloudWatch Logs, allowing you to monitor the update in real-time from anywhere.

## Quick Start

### 1. List Recent Update Runs

```bash
./watch-aws-update.sh
```

This will show you all recent update runs with their timestamps.

### 2. Watch a Specific Update Run

```bash
./watch-aws-update.sh 2025-12-24T19-12-00
```

Replace the timestamp with the actual stream name from step 1.

### 3. Watch the Most Recent Update

```bash
cd backend/aws
node tail-cloudwatch-logs.js $(node tail-cloudwatch-logs.js | grep -A1 "1\." | tail -1 | awk '{print $2}')
```

Or simply:
```bash
cd backend/aws
node tail-cloudwatch-logs.js
# Then copy the most recent stream name and run:
node tail-cloudwatch-logs.js <stream-name>
```

## Installation

### Install Required Package

```bash
cd backend
npm install @aws-sdk/client-cloudwatch-logs
```

### Configure AWS Credentials

Make sure your AWS credentials are configured:

```bash
aws configure
```

Or set environment variables:
```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=us-east-1
```

## How It Works

1. **Automatic Logging**: When the AWS update script runs, it automatically:
   - Creates a CloudWatch log group: `/aws/canvas-wrapper/updates`
   - Creates a log stream with timestamp: `update-run-2025-12-24T19-12-00`
   - Sends all console output to CloudWatch in real-time

2. **Real-time Streaming**: The `tail-cloudwatch-logs.js` script:
   - Connects to CloudWatch Logs
   - Streams log events as they arrive
   - Updates every 2 seconds
   - Shows all log messages with timestamps

## Usage Examples

### Watch Current Update

If an update is running right now:

```bash
# 1. Find the stream name
./watch-aws-update.sh

# 2. Watch it (use the most recent one)
./watch-aws-update.sh 2025-12-24T19-12-00
```

### Watch from AWS Console

1. Go to AWS Console → CloudWatch → Logs → Log groups
2. Find `/aws/canvas-wrapper/updates`
3. Click on the log group
4. Select the most recent log stream
5. Click "View log stream" to see logs in real-time

### Watch via AWS CLI

```bash
aws logs tail /aws/canvas-wrapper/updates --follow --format short
```

Or for a specific stream:
```bash
aws logs tail /aws/canvas-wrapper/updates --log-stream-names update-run-2025-12-24T19-12-00 --follow
```

## Log Stream Naming

Log streams are named with the format:
```
update-run-YYYY-MM-DDTHH-MM-SS
```

Example: `update-run-2025-12-24T19-12-00`

This makes it easy to identify when each update ran.

## Environment Variables

You can configure CloudWatch logging with these environment variables:

```bash
# Enable/disable CloudWatch logging (default: true)
ENABLE_CLOUDWATCH_LOGS=true

# Custom log group name (default: /aws/canvas-wrapper/updates)
CLOUDWATCH_LOG_GROUP=/aws/canvas-wrapper/updates

# Custom log stream prefix (default: update-run)
CLOUDWATCH_LOG_STREAM_PREFIX=update-run

# AWS region (default: us-east-1)
AWS_REGION=us-east-1
```

## Troubleshooting

### No Logs Appearing

1. **Check AWS credentials:**
   ```bash
   aws sts get-caller-identity
   ```

2. **Check log group exists:**
   ```bash
   aws logs describe-log-groups --log-group-name-prefix /aws/canvas-wrapper
   ```

3. **Check permissions:**
   Your AWS user/role needs these permissions:
   - `logs:CreateLogGroup`
   - `logs:CreateLogStream`
   - `logs:PutLogEvents`
   - `logs:DescribeLogStreams`
   - `logs:GetLogEvents`

### Logs Delayed

CloudWatch Logs may have a slight delay (usually < 5 seconds). The tail script polls every 2 seconds to minimize this.

### Stream Not Found

If you see "Log stream not found", the update may not have started yet, or CloudWatch logging may be disabled. Check:
- Is `ENABLE_CLOUDWATCH_LOGS` set to `false`?
- Has the update script started running?
- Are AWS credentials configured correctly?

## Benefits

✅ **Real-time monitoring** - See updates as they happen
✅ **Persistent logs** - All logs saved in CloudWatch
✅ **Access from anywhere** - View logs via AWS Console or CLI
✅ **No local dependencies** - Works even if local logs are lost
✅ **Searchable** - Use CloudWatch Insights to search logs
✅ **Alerts** - Set up CloudWatch alarms on errors

## Next Steps

1. **Set up CloudWatch Alarms** for failed updates
2. **Use CloudWatch Insights** to query logs
3. **Create dashboards** to visualize update metrics
4. **Set up SNS notifications** for update completion

## Example Output

```
🔍 CloudWatch Logs Tail
============================================================
   Log Group: /aws/canvas-wrapper/updates
============================================================

📡 Streaming logs from: 2025-12-24T19-12-00
   (Press Ctrl+C to stop)

[INFO] 🚀 AWS Update Checker Runner
[INFO] ============================================================
[INFO]    Instance ID: i-09e83866e4ae5eeb2
[INFO]    Region: us-east-1
[INFO] ============================================================
[INFO] 
[INFO] 📋 Step 1: Starting AWS instance...
[INFO] ✅ Instance is running and SSH is ready
[INFO] 
[INFO] 📋 Step 2: Syncing code and dependencies to AWS instance...
[INFO] 📤 Syncing code to AWS instance...
[INFO] ✅ Code synced successfully
...
```




