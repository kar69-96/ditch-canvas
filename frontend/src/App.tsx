import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { RouteGuard } from "@/components/RouteGuard";
import { SidebarProvider } from "@/components/SidebarViewer";
import { useEffect } from "react";
import { getPreferences, applyTheme, applyFont } from "@/lib/preferences";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Calendar from "./pages/Calendar";
import Classes from "./pages/Classes";
import ClassDetail from "./pages/ClassDetail";
import Assignments from "./pages/Assignments";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes - data is fresh for 5 minutes
      gcTime: 30 * 60 * 1000, // 30 minutes - keep in cache for 30 minutes (formerly cacheTime)
      refetchOnWindowFocus: false, // Don't refetch when window regains focus
      refetchOnMount: false, // Use cached data if available instead of refetching
      retry: 1, // Only retry once on failure
    },
  },
});

const AppContent = () => {
  // Load and apply user preferences globally on app startup
  useEffect(() => {
    const prefs = getPreferences();
    applyTheme(prefs.theme);
    applyFont(prefs.font);
  }, []);
  return (
    <SidebarProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Login />} />
          
          {/* Protected routes */}
          <Route path="/onboarding" element={
            <RouteGuard>
              <Onboarding />
            </RouteGuard>
          } />
          <Route path="/dashboard" element={
            <RouteGuard>
              <Dashboard />
            </RouteGuard>
          } />
          <Route path="/calendar" element={
            <RouteGuard>
              <Calendar />
            </RouteGuard>
          } />
          <Route path="/classes" element={
            <RouteGuard>
              <Classes />
            </RouteGuard>
          } />
          <Route path="/classes/:id" element={
            <RouteGuard>
              <ClassDetail />
            </RouteGuard>
          } />
          <Route path="/assignments" element={
            <RouteGuard>
              <Assignments />
            </RouteGuard>
          } />
          
          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </SidebarProvider>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppContent />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
