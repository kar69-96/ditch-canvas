# Canvas LMS Data Extraction & Management System

🎓 **Advanced Canvas LMS data extraction with Browserbase automation and modern React frontend**

A production-ready full-stack system that extracts Canvas assignments, courses, files, and modules using Browserbase's cloud browser infrastructure, and provides a beautiful React dashboard for viewing and managing the extracted data. 


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

## 📄 License

MIT License

---










