# YAY_FINAL - Canvas LMS Data Extraction & Management System

🎓 **Advanced Canvas LMS data extraction with Browserbase automation and modern React frontend**

A production-ready full-stack system that extracts Canvas assignments, courses, files, and modules using Browserbase's cloud browser infrastructure, and provides a beautiful React dashboard for viewing and managing the extracted data.

## 🏗️ Project Structure

```
YAY_FINAL/
├── backend/          # Canvas data extraction engine
├── frontend/         # React dashboard application
├── docs/            # Documentation
│   ├── BACKEND.md   # Backend documentation
│   └── FRONTEND.md  # Frontend documentation
├── .env.backend     # Backend environment variables (consolidate manually)
├── .env.frontend    # Frontend environment variables (consolidate manually)
└── package.json     # Root package.json with unified scripts
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm run install:all
```

This installs dependencies for root, backend, and frontend.

### 2. Set Up Environment Variables

Consolidate `.env.backend` and `.env.frontend` into a single `.env` file at the root, or keep them separate. See the respective documentation files for required variables:

- **Backend**: See `docs/BACKEND.md` for Canvas, Browserbase, and AWS configuration
- **Frontend**: See `docs/FRONTEND.md` for Supabase and API configuration

### 3. Run Development Servers

```bash
# Run both backend and frontend concurrently
npm run dev

# Or run separately:
npm run dev:backend   # Backend API server
npm run dev:frontend   # Frontend Vite dev server
```

### 4. Build for Production

```bash
npm run build         # Build frontend
npm start             # Start backend server
```

## 📋 Available Scripts

### Development
- `npm run dev` - Run both backend and frontend concurrently
- `npm run dev:backend` - Run backend server only
- `npm run dev:frontend` - Run frontend dev server only

### Backend Scripts
- `npm run backend:auth:extract-cookies` - Extract Canvas cookies
- `npm run backend:crawl:canvas` - Run Canvas data extraction
- `npm run backend:aws:extract` - Run AWS-based extraction
- `npm run backend:aws:check` - Check AWS setup
- See `docs/BACKEND.md` for more backend commands

### Frontend Scripts
- `npm run frontend:supabase:sync` - Sync Supabase migrations
- `npm run frontend:supabase:upload-data` - Upload extraction data
- `npm run frontend:lint` - Run ESLint
- See `docs/FRONTEND.md` for more frontend commands

## ✨ Key Features

### Backend
- 🔍 Multi-layered Canvas content discovery
- 📋 Complete assignment data extraction
- 🤖 Browserbase & Director AI integration
- ⚡ High-performance parallel processing
- 🔒 Secure encrypted cookie management
- ☁️ AWS EC2 deployment support

### Frontend
- 📊 Beautiful dashboard with calendar view
- 🎨 Customizable themes and fonts
- 📁 Course and assignment management
- 🔐 Supabase authentication
- 📱 Responsive design
- 🎯 Real-time data updates

## 📚 Documentation

- **[Backend Documentation](docs/BACKEND.md)** - Canvas extraction, Browserbase setup, AWS deployment
- **[Frontend Documentation](docs/FRONTEND.md)** - React app, Supabase integration, UI components

## 🛠️ Technology Stack

### Backend
- Node.js/Express
- Crawlee (web scraping)
- Playwright (browser automation)
- Browserbase (cloud browsers)
- AWS SDK (EC2, CloudWatch)
- Supabase (database)

### Frontend
- React 18 + TypeScript
- Vite
- Tailwind CSS + shadcn/ui
- Supabase Client
- TanStack Query
- Framer Motion

## 📄 License

MIT License

---

**Made for students who want to take control of their Canvas data** 🎓

