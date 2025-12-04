# Working Project

This project combines the best of both reference implementations:

## Design & Styling (from Reference 1)
- **Clean, minimal design** with exposed-card styling
- **Theme system**: Light, Dark, Paper, and Ink themes
- **Font system**: Sans, Mono, Serif, and Geometric fonts
- **Smooth animations**: fade-up and fade-in animations
- **Beautiful onboarding flow** with theme and font selection

## Content & Backend (from Reference 2)
- **Full backend integration** with Supabase
- **Authentication system** with route guards
- **Multiple pages**: Dashboard, Calendar, Classes, ClassDetail, ChatPopout, PdfViewer, CanvasImport
- **Services**: Chat service, mock API, scraping status
- **Storage utilities**: Session, user, and scraping storage
- **Integrations**: Supabase client, Gemini AI integration
- **Data**: Mock Canvas data, backgrounds, schools

## Key Features

### Styling System
- Uses Reference 1's clean, minimal design language
- `exposed-card` class for consistent card styling
- Border-based layout system
- Typography system with multiple font options

### Components
- **Layout**: Navigation bar with clean styling matching Reference 1
- **RouteGuard**: Protects routes with authentication
- **GlassCard**: Adapted to use Reference 1's card styling
- **Dashboard components**: WelcomeHeader, WeeklyCalendar, ActiveClasses, SemesterProgress, DueToday

### Pages
All pages from Reference 2 are included:
- `/` - Dashboard
- `/calendar` - Calendar view
- `/classes` - Classes list
- `/classes/:id` - Class detail
- `/chat/:id` - Chat popout
- `/pdf-viewer` - PDF viewer
- `/import` - Canvas import
- `/onboarding` - Onboarding flow (uses Reference 1's design)

## Getting Started

```sh
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Project Structure

```
working/
├── src/
│   ├── components/
│   │   ├── dashboard/      # Dashboard components from Reference 1
│   │   ├── onboarding/    # Onboarding components from Reference 1
│   │   ├── ui/            # shadcn UI components
│   │   ├── Layout.tsx     # Navigation layout (adapted)
│   │   ├── RouteGuard.tsx # Route protection
│   │   └── GlassCard.tsx  # Card component (adapted)
│   ├── pages/             # All pages from Reference 2
│   ├── hooks/             # React hooks
│   ├── lib/               # Utilities and preferences
│   ├── integrations/      # Supabase integration
│   ├── services/          # API services
│   ├── storage/           # Storage utilities
│   ├── data/              # Mock data
│   └── assets/            # Images and assets
├── public/                # Public assets
└── supabase/              # Supabase configuration
```

## Styling Notes

The project uses Reference 1's styling system:
- CSS variables for theming
- `exposed-card` utility class for cards
- Border-based design language
- Clean typography with font options

All pages have been adapted to use this styling system while maintaining their functionality from Reference 2.


