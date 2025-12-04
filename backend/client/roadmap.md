# Roadmap

## Vision
- Style: Futuristic minimalism — high contrast, spacious layout, subtle glassmorphism, neon accents, motion used sparingly.
- Priorities: Clarity first, speed, and resilience to API changes via typed models and a modular data layer.

## API Integration
- Source of truth: `API-DOCUMENTATION.md`. Lock endpoint shapes into typed models.
- Models: Define Request/Response types, e.g., `ApiResponse<T>`, domain entities (Assignment, Course, Summary).
- Client: Lightweight fetch wrapper with interceptors for baseURL, headers, retries, and error normalization.
- Config: Single base `API_BASE = /api` with feature-level paths (e.g., `/extraction/assignments`).

## Data Layer
- Structure: `src/lib/http.ts` (client), `src/lib/api/{feature}.ts` (endpoints), `src/types/{feature}.ts`.
- Hooks: `src/hooks/useAssignments.ts`, `useCourses.ts`, etc., powered by React Query (or lightweight custom cache).
- Concerns: Pagination, filtering, optimistic updates (status changes), request cancellation.

## UI/UX Style
- Tokens: Neutral dark base, neon accent (teal/purple), 12/14/16 spacing scale, 8px radius, 1px low-contrast borders.
- Components: Minimal cards, grids, pill badges, slim progress bars, compact tables.
- Motion: 150–200ms transitions, micro-interactions; respect `prefers-reduced-motion`.
- Typography: Inter or Sora; weights 400/600.

## Information Architecture
- Dashboard: KPIs (totals, status breakdown), upcoming/overdue list, quick filters.
- Assignments: Filter/search, sort, pagination, bulk actions.
- Courses: Summary grid + drill-down.
- Details: Assignment modal/drawer with update capability.
- Navigation: Minimal left sidebar + top utility bar (search, theme toggle).

## Components
- Primitives: Button, Input, Select, Toggle, Badge, Tooltip, Dialog/Drawer.
- Data: AssignmentCard, AssignmentTable, CourseCard, KPIStat, ChartMini.
- Feedback: EmptyState, ErrorState, Skeletons, Toaster.
- Patterns: FilterBar, Pagination, SortControl, ResponsiveGrid.

## State, Caching, and Sync
- Strategy: Stale-while-revalidate caching; dedupe in-flight requests.
- Query keys: Namespaced per feature (e.g., `['assignments', { status, page }]`).
- Mutations: Status updates with optimistic UI and server reconciliation.
- Offline: Cache last-fetched data; graceful degradation offline.

## Loading, Error, and Empty States
- Loading: Skeletons for lists/cards; spinners only for small areas.
- Error: Inline retry, toast with normalized message, page-level fallback.
- Empty: Guidance + primary CTA to refresh or adjust filters.

## Theming and Branding
- Theme: Dark default, light optional; accent via CSS variables.
- Implementation: CSS variables + utility classes; glass panels via `backdrop-filter` with accessible contrast.

## Accessibility
- WCAG AA contrast; semantic landmarks; keyboard-first navigation.
- Focus states: High-visibility rings; skip-to-content link.
- Announce loading/errors via `aria-live` regions.

## Performance
- Budgets: LCP < 2.5s, interactivity < 1.8s on mid devices.
- Techniques: Code-split routes, memoize heavy components, virtualize long lists, lazy-load images.
- Network: Combine small requests; leverage server cache-control when available.

## Testing
- Unit: Component logic and formatters.
- Integration: Hooks with mocked API; key flows (filtering, pagination, updates).
- Visual: Critical snapshots for theme/contrast; minimal and stable baselines.

## Developer Experience
- Structure: `src/app` (routes/layout), `src/components` (ui, data), `src/lib` (http, utils), `src/hooks`, `src/types`, `src/styles`.
- Conventions: PascalCase components, camelCase hooks/utils, barrel exports per feature.
- Lint/Format: ESLint + Prettier; commit hooks for typecheck/lint.

## Deployment
- Targets: Static hosting or edge-friendly platform.
- Build: Single `build` output; environment via `VITE_` vars.
- Monitoring: Basic error logging; surface API failures with correlation ids if available.

## Milestones
- M1: Contracts + models + HTTP client.
- M2: Design tokens, theme, primitives.
- M3: Dashboard + Assignments list (read-only).
- M4: Mutations (status updates) + optimistic UI.
- M5: Courses + Details + routing.
- M6: Accessibility passes, performance tuning.
- M7: Tests, docs, and deployment.
