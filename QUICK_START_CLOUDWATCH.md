# Quick Start: CloudWatch Monitoring

## 🚀 Watch AWS Update Live

### Step 1: Install Dependencies (One-time)

```bash
cd backend
npm install
```

### Step 2: Watch the Current Update

```bash
# From project root
./watch-aws-update.sh
```

This will:
1. List recent update runs
2. Show you the most recent one
3. Let you watch it in real-time

### Step 3: Watch a Specific Update

```bash
./watch-aws-update.sh 2025-12-24T19-12-00
```

Replace with the actual timestamp from step 2.

## 📋 What You'll See

The script streams logs in real-time showing:
- ✅ Instance startup
- 📤 Code syncing
- 🔍 Update checking
- 📊 Progress updates
- ✅ Completion status

## 🔧 Troubleshooting

### "AWS CLI not found"
```bash
# Install AWS CLI
brew install awscli  # macOS
# or
pip install awscli   # Linux/Windows
```

### "No log streams found"
- The update hasn't started yet, or
- CloudWatch logging is disabled (check `ENABLE_CLOUDWATCH_LOGS` in .env)

### "Access Denied"
- Check AWS credentials: `aws sts get-caller-identity`
- Ensure your AWS user has CloudWatch Logs permissions

## 📖 Full Documentation

See `CLOUDWATCH_MONITORING.md` for complete details.




