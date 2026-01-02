# AWS Update Integration - Implementation Guide

## Overview

This document describes the automatic AWS update integration that runs after every successful user login. The system automatically extracts Canvas data updates and uploads them to Supabase whenever a user logs in.

## How It Works

### 1. Login Flow
When a user logs in through the streaming authentication:
1. User enters credentials in the popup browser window
2. Cookies are extracted and saved to an email-specific file
3. The system detects successful cookie extraction
4. Cookies are copied to the main `canvas-cookies.json` file
5. **AWS update script is automatically triggered in the background**

### 2. AWS Update Process
The AWS update script (`backend/aws/run-aws-update.js`):
1. Starts the AWS EC2 instance
2. Syncs the latest code and cookies to the instance
3. Runs the Canvas update checker
4. Detects changes in courses, assignments, files
5. Uploads changes to Supabase
6. Hibernates the AWS instance to save costs

### 3. Automatic Triggers

The AWS update is triggered automatically when:
- Cookie extraction completes (detected by output message)
- Streaming process exits successfully
- Cookies are successfully copied to main file

Multiple trigger points ensure the update runs even if one trigger is missed.

## Configuration

### Required Environment Variables

In your `.env` file (root or `backend/.env`):

```bash
# AWS Configuration
AWS_INSTANCE_ID=i-02e3289c96e66905c  # Your EC2 instance ID
AWS_KEY_FILE=Canvas-Wrapper.pem       # Path to SSH key
AWS_REGION=us-east-1                   # AWS region
AWS_SSH_USER=ec2-user                  # SSH user (default: ec2-user)

# Supabase Configuration (for uploading data)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
```

### Verification

To verify AWS integration is configured correctly:

1. **Check environment variables:**
   ```bash
   cd backend
   node -e "require('dotenv').config(); console.log('AWS_INSTANCE_ID:', process.env.AWS_INSTANCE_ID)"
   ```

2. **Check AWS update script exists:**
   ```bash
   ls -la backend/aws/run-aws-update.js
   ```

3. **Check cookie file location:**
   ```bash
   ls -la backend/data/auth/
   ```

## Logging

### Backend Server Logs

When a user logs in, you should see these logs in the backend:

```
[streaming-auth] Checking extraction results for: user@colorado.edu
[streaming-auth]    Looking for file: /path/to/canvas-cookies-user-colorado-edu.json
[streaming-auth]    File exists: true
[streaming-auth]    Cookie data parsed successfully
[streaming-auth]    Username: user@colorado.edu
[streaming-auth]    Cookies count: 15
[streaming-auth] ✅ Stored extraction results for user@colorado.edu
[streaming-auth] Starting cookie copy process...
[streaming-auth] Copying cookies to main file...
[streaming-auth]    From: /path/to/canvas-cookies-user-colorado-edu.json
[streaming-auth]    To: /path/to/canvas-cookies.json
[streaming-auth] ✅ Copied cookies to main file
[streaming-auth] ✅ Cookies copied successfully, triggering AWS update...
[streaming-auth] ✅ Starting AWS update script in background...
[streaming-auth]    AWS Instance ID: i-02e3289c96e66905c
[streaming-auth]    AWS update process started with PID: 12345
[aws-update] 🚀 AWS Update Checker Runner
[aws-update] Starting AWS instance...
[aws-update] Syncing code to AWS...
[aws-update] Running update checker...
[aws-update] ✅ Update check completed
[streaming-auth] ✅ AWS update script completed successfully
```

### If AWS Update Doesn't Run

Check these logs to diagnose:

1. **AWS_INSTANCE_ID not configured:**
   ```
   [streaming-auth] AWS_INSTANCE_ID not configured, skipping AWS update
   ```
   **Solution:** Add `AWS_INSTANCE_ID` to your `.env` file

2. **AWS script not found:**
   ```
   [streaming-auth] AWS update script not found at: /path/to/script
   ```
   **Solution:** Ensure `backend/aws/run-aws-update.js` exists

3. **Cookie file not found:**
   ```
   [streaming-auth] ⚠️  Cookie file not found, cannot process extraction results
   ```
   **Solution:** Check that cookies were saved during login

4. **Cookie copy failed:**
   ```
   [streaming-auth] ❌ Failed to copy cookies, AWS update will not run
   ```
   **Solution:** Check file permissions and disk space

## Manual Testing

You can manually trigger the AWS update process for testing:

### Method 1: API Endpoint

```bash
# Trigger update manually (requires existing cookies)
curl -X POST http://localhost:3000/api/streaming-auth/trigger-update
```

Response:
```json
{
  "success": true,
  "message": "AWS update script triggered in background",
  "awsInstanceId": "i-02e3289c96e66905c"
}
```

### Method 2: Direct Script

```bash
cd backend/aws
node run-aws-update.js
```

## Troubleshooting

### Problem: AWS update runs but finds no changes

**Possible Causes:**
1. Canvas data hasn't changed since last extraction
2. Extraction summary file not found on AWS
3. Cookies are invalid or expired

**Solution:**
- Check AWS logs for "No updates found" message
- Verify extraction summary exists: `backend/storage/datasets/`
- Re-login to get fresh cookies

### Problem: AWS update takes too long

**Expected Duration:**
- Instance startup: 1-2 minutes
- Code sync: 30 seconds
- Update check: 2-5 minutes (depending on number of courses)
- Instance hibernate: 30 seconds

**Total:** 4-8 minutes per run

The process runs in the background and doesn't block the login flow.

### Problem: Multiple updates running simultaneously

**Prevention:**
The system prevents duplicate runs by tracking active AWS update processes:
```javascript
if (activeAwsUpdateProcesses.size > 0) {
  console.log('[streaming-auth] AWS update script already running, skipping duplicate run');
  return;
}
```

## Implementation Details

### File Locations

1. **Email-specific cookies:**
   - Location: `backend/data/auth/canvas-cookies-{sanitized-email}.json`
   - Used for: User-specific cookie storage
   - Cleaned up on logout

2. **Main cookies file:**
   - Location: `backend/data/auth/canvas-cookies.json`
   - Used for: AWS update script compatibility
   - Updated on every successful login

3. **AWS update script:**
   - Location: `backend/aws/run-aws-update.js`
   - Function: Orchestrates the entire update process

### Code Locations

1. **Trigger logic:**
   - File: `backend/src/routes/streaming-auth.js`
   - Function: `checkAndStoreExtractionResults()`
   - Triggers: On cookie extraction completion

2. **Cookie copy:**
   - File: `backend/src/routes/streaming-auth.js`
   - Function: `copyCookiesToMainFile()`
   - Purpose: Copy email-specific cookies to main file

3. **AWS update runner:**
   - File: `backend/src/routes/streaming-auth.js`
   - Function: `runAwsUpdateInBackground()`
   - Purpose: Spawn AWS update script as detached process

## Performance Considerations

### Background Execution
- Update runs in a **detached process**
- **Non-blocking** - doesn't slow down login
- User can start using the app immediately
- Updates appear within 4-8 minutes

### Cost Optimization
- Instance hibernates automatically after update
- Only runs when user logs in
- No continuous polling or scheduled jobs
- Pay only for actual usage time

### Rate Limiting
- Prevents duplicate runs
- Max one update per login session
- Checks for existing processes before starting

## Future Enhancements

### Planned Features
1. **Update notifications:** Notify user when update completes
2. **Progress tracking:** Show update progress in UI
3. **Retry logic:** Auto-retry on transient failures
4. **Batch updates:** Combine multiple logins into single update
5. **Webhook notifications:** Notify external systems when update completes

### Optional Configurations
1. **Disable auto-update:** Add `DISABLE_AUTO_UPDATE=true` to `.env`
2. **Update on logout:** Trigger update when user logs out
3. **Scheduled updates:** Run updates on schedule instead of login

## Summary

✅ **Automatic AWS updates are now integrated into the login flow**
✅ **Non-blocking background execution**
✅ **Comprehensive logging for debugging**
✅ **Manual trigger endpoint for testing**
✅ **Cost-optimized with instance hibernation**

The system ensures that Canvas data is automatically updated in Supabase whenever a user logs in, keeping the platform data fresh without manual intervention.




