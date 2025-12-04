# Canvas Wrapper

🎓 **Advanced Canvas LMS data extraction with Browserbase automation**

A production-ready system that extracts Canvas assignments, courses, files, and modules using Browserbase's cloud browser infrastructure and Director AI. Perfect for students, researchers, and institutions who need comprehensive academic data extraction with minimal human intervention.

## ✨ What It Does

- 🔍 **Multi-Layered Content Discovery** - Extracts assignments, modules, files, pages, and announcements
- 📋 **Complete Assignment Data** - Due dates, points, submission status, grades, and descriptions
- 📁 **Intelligent File Discovery** - Module-based file extraction with 8-layer discovery system
- 👻 **Headless Operation** - Runs completely invisibly after one-time authentication setup
- 🤖 **Director AI Integration** - Natural language-based extraction with 95% AI usage
- ⚡ **High Performance** - 6 courses with 100+ assignments in 2-3 minutes
- 🗃️ **Production Database** - Supabase integration with structured data storage
- 🔒 **Secure Authentication** - Encrypted cookie management with automatic reauth

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
npx playwright install chromium
```

### 2. Set Up Environment
```bash
# Copy the environment template
cp .env.example .env

# Edit .env with your configuration
```

Required environment variables:
```bash
# Browserbase Configuration (Required)
BROWSERBASE_API_KEY=your_browserbase_api_key
BROWSERBASE_PROJECT_ID=your_project_id

# Canvas Configuration
CANVAS_URL=https://your-institution.instructure.com
CANVAS_LOGIN_URL=https://your-institution.instructure.com/login

# Supabase Database (Recommended)
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_KEY=your_supabase_service_key

# Security Keys (generate with scripts/generate-keys.js)
JWT_SECRET=your_jwt_secret_32_chars
SESSION_SECRET=your_session_secret_32_chars
ENCRYPTION_KEY=your_encryption_key_32_chars

# Anthropic API Keys (Optional - for chatbot features)
ANTHROPIC_API_KEY=chatbot_model_api_key
ANTHROPIC_ASSIGNMENT_API_KEY=extraction_model_api_key
```

### 3. Set Up Database
Run the Supabase schema in your database:
```bash
# Copy the contents of supabase-schema.sql 
# and run it in your Supabase SQL editor
```

### 4. Browserbase Authentication Setup
```bash
# Test Browserbase connectivity
npm run test:browserbase

# Extract Canvas cookies locally (one-time setup)
npm run auth:extract-cookies

# Inject cookies into Browserbase
npm run browserbase:inject-cookies
```

### 5. Run Data Extraction
```bash
# Basic extraction
npm run extract:canvas-data

# Full automated extraction with Director AI
npm run browserbase:full-scrape

# Director AI-only extraction
npm run director:scrape
```

### 6. Launch the Application
```bash
npm start
# Visit http://localhost:3000
```

## 📋 Available Commands

### Authentication & Setup
| Command | Description |
|---------|-------------|
| `npm run auth:extract-cookies` | Extract Canvas cookies locally (one-time setup) |
| `npm run browserbase:inject-cookies` | Inject cookies into Browserbase context |
| `npm run browserbase:setup` | Manual Browserbase setup via Live View |
| `npm run browserbase:alert` | Check authentication status |
| `npm run test:browserbase` | Test Browserbase connectivity |

### Data Extraction
| Command | Description |
|---------|-------------|
| `npm run extract:canvas-data` | Basic Canvas data extraction |
| `npm run browserbase:full-scrape` | Complete automated extraction |
| `npm run director:scrape` | Director AI-based extraction |
| `npm run browserbase:prompt` | Generate extraction prompts |

### Application
| Command | Description |
|---------|-------------|
| `npm start` | Start the server + frontend at http://localhost:3000 |
| `npm run dev` | Concurrent dev servers for API + Vite frontend |
| `node server.js` | Start only the backend API |

### Testing & Utilities
| Command | Description |
|---------|-------------|
| `npm run director:test-courses` | Test Director AI course extraction |
| `npm run director:test-assignments` | Test Director AI assignment extraction |
| `npm run director:test-files` | Test Director AI file extraction |
| `npm run seed:canvas` | Seed demo branching conversation |
| `npm run test:canvas` | Smoke-test the canvas API |

## 🌐 Frontend Interface

The unified React app (served on port 3000) includes:
- **Assignments view** – track coursework, overrides, and submission status.
- **Canvas view** – visual conversation canvas with branching, drag/zoom, node inspector, and keyboard shortcuts (`Enter` to run, `B` to branch).
- **Tutor view** – course-grounded learning-mode sparring partner with ChatGPT-style formatting.
- REST APIs live under `http://localhost:3000/api/*`.

To explore the canvas quickly you can seed demo data:

```
npm run seed:canvas
npm start
```

Then select **Canvas** in the header and open “Demo Conversation” to inspect the forked threads.

## 📊 What Gets Extracted

### From Canvas:
- ✅ **Favorited Courses Only** - Only courses you've starred in Canvas
- ✅ **All Assignments** - Complete assignment details with descriptions
- ✅ **Due Dates & Times** - Precise due date information
- ✅ **Points Possible** - Point values for each assignment
- ✅ **Submission Status** - Submitted, unsubmitted, or graded status
- ✅ **Grades & Scores** - Current grades and point scores
- ✅ **Assignment URLs** - Direct links back to Canvas assignments

### Example Extraction Results:
```
🎯 7 favorited courses found
📋 105 assignments extracted
⏱️ 164.5 seconds total time
👻 Completely invisible (headless)
```

## 🗂️ Extraction Output & Baselines

Every successful full extraction now emits a normalized summary so the lightweight AWS update job can diff against a stable snapshot without mutating stored datasets.

- `storage/datasets/extraction-*/` — timestamped folders that contain the raw Crawlee datasets (assignments, announcements, modules, files, and pages).
- `storage/datasets/extraction-*/extraction-summary.json` — a consolidated per-course snapshot produced by `scripts/generate-extraction-summary.js`. The AWS extraction runner automatically executes this script for the latest extraction folder as soon as the crawl completes.
- `storage/multi-course-summary.json` — a high-level rollup that’s primarily used for reporting and monitoring.

Need to regenerate a summary manually?

```bash
node scripts/generate-extraction-summary.js extraction-2025-01-01T12-00-00-000Z
```

Keep this trio (raw dataset directory + extraction-summary.json + multi-course summary) together—they serve as the baseline the fast “aws:update” surface check compares against.

## 🧪 Testing

With the server running on port 3000 you can exercise the branching canvas API:

```
npm run test:canvas
```

The script creates a conversation, runs a prompt, branches the first response, and continues the branch to confirm the full flow.

## 🏗️ Project Structure

```
canvas-wrapper/
├── extractors/           # Core extraction logic
│   ├── canvas-extractor.js          # Base extraction functionality
│   └── headless-canvas-extractor.js # Headless automation wrapper
├── scripts/              # Utility scripts
│   ├── run-headless.js              # Main extraction runner
│   ├── setup-auth.js                # Authentication setup
│   └── auth-status.js               # Check auth status
├── models/               # Database models and schemas
│   ├── index.js                     # MongoDB models (fallback)
│   └── supabase-models.js           # Supabase models (recommended)
├── services/             # Core services
│   ├── auth-service.js              # Authentication management
│   └── canvas-scraper-service.js    # Canvas scraping logic
├── routes/               # API endpoints
├── public/               # Web interface (optional)
├── data/                 # Extracted data and auth cookies
├── supabase-schema.sql   # Complete database schema
└── README.md            # This file
```

## 🔐 Authentication & Security

### How Authentication Works
1. **Setup Phase** (one-time): Run `npm run auth:setup` to complete Canvas login in a browser
2. **Cookie Capture**: System captures and encrypts your session cookies
3. **Headless Phase**: Future extractions use saved cookies automatically
4. **Automatic Expiration**: Cookies expire after 24 hours for security

### Security Features
- 🔒 **AES-256-GCM Encryption** for stored cookies
- ⏰ **Automatic Expiration** prevents stale sessions
- 🚫 **No Credentials Stored** - only session cookies
- 🎯 **Canvas-Specific** cookies only
- 🧹 **Automatic Cleanup** of expired data

### Checking Authentication Status
```bash
npm run auth:status
```
Possible statuses:
- ✅ **VALID** - Ready for extraction
- ⏰ **EXPIRED** - Need to re-run auth:setup
- ❌ **NOT_AUTHENTICATED** - Need to run auth:setup

## 🌐 Database Options

### Supabase (Recommended)
- Production-grade PostgreSQL
- Real-time capabilities  
- Automatic backups
- Row-level security

Setup:
1. Create a Supabase project
2. Copy `supabase-schema.sql` contents to Supabase SQL editor
3. Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to `.env`

### MongoDB (Fallback)
Automatically used if Supabase isn't available.

## ☁️ Cloud Deployment

### Production Environment Setup

The system is designed for cloud deployment with Browserbase handling browser infrastructure:

#### Environment Variables for Production
```bash
NODE_ENV=production
CLOUD_ENV=true
HEADLESS_MODE=true

# Browserbase Configuration (Required)
BROWSERBASE_API_KEY=your_production_api_key
BROWSERBASE_PROJECT_ID=your_production_project_id

# Canvas Configuration
CANVAS_URL=https://your-institution.instructure.com
CANVAS_LOGIN_URL=https://your-institution.instructure.com/login

# Database Configuration
SUPABASE_URL=your_production_supabase_url
SUPABASE_SERVICE_KEY=your_production_service_key

# Security Keys
JWT_SECRET=your_production_jwt_secret
SESSION_SECRET=your_production_session_secret
ENCRYPTION_KEY=your_production_encryption_key
```

#### Docker Support
```dockerfile
# Dockerfile for production deployment
FROM node:18-alpine

# Install dependencies
RUN apk add --no-cache chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy application
COPY . /app
WORKDIR /app
RUN npm ci --only=production

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
```

#### Scheduled Extractions
```bash
# Cron job - daily at 6 AM
0 6 * * * cd /path/to/canvas-wrapper && npm run extract:canvas-data

# Cron job - check authentication status every hour
0 * * * * cd /path/to/canvas-wrapper && npm run browserbase:alert
```

### Deployment Platforms

#### Heroku
```bash
# Add buildpack for Node.js
heroku buildpacks:set heroku/nodejs

# Add environment variables
heroku config:set BROWSERBASE_API_KEY=your_key
heroku config:set BROWSERBASE_PROJECT_ID=your_project_id
heroku config:set CANVAS_URL=your_canvas_url
heroku config:set SUPABASE_URL=your_supabase_url
heroku config:set SUPABASE_SERVICE_KEY=your_service_key

# Deploy
git push heroku main
```

#### Railway
```bash
# Connect to Railway
railway login
railway init

# Set environment variables
railway variables set BROWSERBASE_API_KEY=your_key
railway variables set BROWSERBASE_PROJECT_ID=your_project_id
railway variables set CANVAS_URL=your_canvas_url

# Deploy
railway up
```

#### DigitalOcean App Platform
```yaml
# .do/app.yaml
name: canvas-wrapper
services:
- name: web
  source_dir: /
  github:
    repo: your-username/canvas-wrapper
    branch: main
  run_command: npm start
  environment_slug: node-js
  instance_count: 1
  instance_size_slug: basic-xxs
  envs:
  - key: BROWSERBASE_API_KEY
    value: your_key
  - key: BROWSERBASE_PROJECT_ID
    value: your_project_id
  - key: CANVAS_URL
    value: your_canvas_url
```

### Production Considerations

#### Security
- Use environment variables for all sensitive data
- Enable HTTPS in production
- Implement proper access controls
- Regular security updates and monitoring

#### Monitoring
- Set up performance monitoring
- Implement error alerting
- Track extraction success rates
- Monitor authentication status

#### Scaling
- Use Browserbase's built-in scaling
- Implement request queuing
- Add load balancing for multiple instances
- Monitor resource usage

#### Backup Strategy
- Backup extracted data regularly
- Store authentication cookies securely
- Maintain extraction history
- Document configuration changes

## 🔧 Configuration Options

### Canvas Settings
```bash
# Your institution's Canvas URL
CANVAS_URL=https://canvas.university.edu
# or
CANVAS_URL=https://institution.instructure.com
```

### Extraction Settings
```bash
# Maximum concurrent courses (default: 3)
MAX_CONCURRENT_COURSES=3

# Maximum assignments per course (default: 50)  
MAX_ASSIGNMENTS_PER_COURSE=50

# Only extract favorited courses (default: true)
ONLY_FAVORITES=true
```

### Performance Settings
```bash
# Browser timeout settings (milliseconds)
BROWSER_TIMEOUT=120000
NAVIGATION_TIMEOUT=90000
DEFAULT_TIMEOUT=60000
```

## 🐛 Troubleshooting

### Authentication Issues
```bash
# Problem: "Authentication required" error
# Solution: Re-authenticate
npm run auth:setup

# Problem: Authentication setup window closes too quickly
# Solution: Check Canvas URL in .env file
```

### Extraction Issues
```bash
# Problem: "No courses found"
# Solution: Make sure you have favorited courses in Canvas
# Go to Canvas → Dashboard → Click stars next to course names

# Problem: Extraction timeout
# Solution: Check internet connection and Canvas accessibility
```

### Browser Issues
```bash
# Problem: "Navigation timeout" in headless mode
# Solution: Verify Canvas URL and internet connection

# Problem: "Target closed" error in cloud
# Solution: Add memory optimization flags to environment
```

### Quick Diagnostic
```bash
# Check authentication status
npm run auth:status

# Clear authentication and start fresh
npm run auth:clear
npm run auth:setup

# View extraction logs
npm run extract
```

## 🎯 Project Purpose & Architecture

### What Problem Does This Solve?

Canvas LMS is a powerful learning management system, but extracting comprehensive academic data programmatically is challenging due to:

- **Authentication Complexity**: SSO/MFA requirements make automated access difficult
- **Content Discovery**: Files and assignments are scattered across modules, pages, and discussions
- **Anti-Bot Detection**: Canvas has sophisticated bot detection that blocks automated access
- **Data Structure**: Academic data is nested and requires intelligent parsing
- **Scale Requirements**: Processing multiple courses efficiently without timeouts

### How This System Solves It

#### 1. **Hybrid Authentication System**
- **Local Cookie Extraction**: Playwright-based authentication for initial setup
- **Cloud Persistence**: Browserbase maintains authenticated sessions
- **Automatic Reauth**: Detects expired sessions and triggers reauthentication

#### 2. **Multi-Layered Content Discovery**
- **8-Layer File Discovery**: Module attachments, assignment files, page embeds, etc.
- **Intelligent Prioritization**: Assignments → modules → files → pages → announcements
- **Deep Content Crawl**: Follows links up to 2 levels deep for comprehensive coverage

#### 3. **Director AI Integration**
- **Natural Language Extraction**: 95% AI usage reduces custom JavaScript complexity
- **Built-in Anti-Detection**: Leverages Browserbase's stealth capabilities
- **Canvas Understanding**: AI understands Canvas UI patterns naturally

#### 4. **Production-Ready Infrastructure**
- **Cloud-Native**: Designed for Browserbase's cloud browser infrastructure
- **Scalable**: Handles multiple courses with parallel processing
- **Monitored**: Real-time status tracking and error alerting
- **Secure**: Encrypted cookie storage and environment-based configuration

### Technical Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Local Auth    │    │   Browserbase    │    │   Canvas LMS    │
│   (Playwright)  │───▶│   Cloud Browser  │───▶│   Data Source   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Cookie Storage  │    │ Director AI      │    │ Extracted Data  │
│ (Encrypted)     │    │ Extraction       │    │ (Structured)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Supabase      │    │   React App      │    │   API Server    │
│   Database      │    │   Frontend       │    │   Backend       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Key Technologies

- **Browserbase**: Cloud browser infrastructure with persistent sessions
- **Director AI**: Natural language-based data extraction
- **Playwright**: Local browser automation for authentication
- **Node.js**: Backend processing and orchestration
- **React**: Frontend interface for data visualization
- **Supabase**: Production database with real-time capabilities

## 🎯 Use Cases

### For Students
- 📊 **Assignment Tracking** - Never miss a due date with comprehensive assignment data
- 📈 **Progress Analysis** - Track submission patterns and academic performance
- 🗂️ **Course Organization** - Centralized view of all course materials and assignments
- ⏰ **Due Date Management** - Upcoming and overdue assignment tracking
- 📁 **File Management** - Access all course files from a single interface

### For Researchers  
- 📋 **Academic Data Export** - Clean, structured data for research analysis
- 📊 **Course Analytics** - Assignment distribution and content analysis
- 🔄 **Automated Data Collection** - Scheduled extractions for longitudinal studies
- 📈 **Progress Tracking** - Historical assignment and performance data
- 🎓 **Institutional Research** - Comprehensive academic data for analysis

### For Institutions
- 🤖 **Headless Operation** - No user interaction required for data collection
- ☁️ **Cloud-Ready** - Deploy anywhere with Browserbase infrastructure
- 🔄 **Scheduled Runs** - Automated data collection via cron jobs
- 📡 **API Integration** - RESTful endpoints for system integration
- 📊 **Data Analytics** - Comprehensive academic data for institutional insights

### For Developers
- 🔧 **API Development** - Build applications on top of Canvas data
- 📱 **Mobile Apps** - Create mobile interfaces for Canvas data
- 🔗 **System Integration** - Connect Canvas data with other academic systems
- 📈 **Custom Analytics** - Build custom dashboards and reports
- 🚀 **Scalable Architecture** - Production-ready infrastructure for large-scale deployments

## 🚨 Important Notes

### Browserbase Account Required
This system requires a Browserbase account for cloud browser infrastructure:
1. Create account at [browserbase.com](https://browserbase.com)
2. Generate API key and project ID
3. Add credentials to `.env` file
4. Test connectivity with `npm run test:browserbase`

### Canvas Course Access
The extractor processes all accessible courses (not just favorited ones):
1. Ensure you have access to courses you want to extract
2. Courses must be visible in your Canvas dashboard
3. Some courses may require specific permissions for file access

### Authentication Requirements
- **One-time setup**: Complete Canvas login through Playwright browser
- **Automatic reauth**: System detects expired sessions and prompts reauthentication
- **Secure storage**: All cookies are encrypted and stored locally
- **Session persistence**: Browserbase maintains authenticated sessions

### Supported Canvas Instances
Works with any Canvas LMS instance:
- University Canvas installations
- Instructure-hosted Canvas
- K-12 Canvas instances
- Corporate Canvas deployments

### Browser Requirements
- Chromium-based browser support
- Works in headless environments
- Memory optimized for cloud deployment
- Automatic fallback handling

## 📄 License

MIT License - feel free to modify and distribute.

## 🆘 Need Help?

1. **Check authentication first**: `npm run auth:status`
2. **Try visible mode for debugging**: Remove `headless: true` from extractor options
3. **Verify Canvas access**: Make sure you can log in to Canvas normally
4. **Check environment variables**: Ensure all required variables are set
5. **Review logs**: Console output provides detailed error information

---

**Made for students who want to take control of their Canvas data** 🎓
