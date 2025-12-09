import { Link, useLocation, useNavigate } from "react-router-dom";
import { Home, Calendar, BookOpen, LogOut, Settings } from "lucide-react";
import { useCourses } from "@/hooks/useCanvasData";
import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { logout } from "@/services/mockApi/auth";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

const Layout = ({ children, constrainNav = false }: { children: React.ReactNode; constrainNav?: boolean }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [showClassesDropdown, setShowClassesDropdown] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [hoveredNavIndex, setHoveredNavIndex] = useState<number | null>(null);
  const [hoveredActionButton, setHoveredActionButton] = useState<"settings" | "logout" | null>(null);
  const navItemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const ulRef = useRef<HTMLUListElement | null>(null);

  // Active fill indicator (moves on route change/click)
  const [activeFillStyle, setActiveFillStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 });
  const [isFillInitialized, setIsFillInitialized] = useState(false);

  // Hover underline indicator - always tracks a position, visibility controlled separately
  const [underlineStyle, setUnderlineStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 });
  const [isUnderlineInitialized, setIsUnderlineInitialized] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      toast({
        title: "Logged out",
        description: "You have been successfully logged out",
      });
      navigate("/login");
    } catch (error: any) {
      console.error("Error logging out:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to log out",
        variant: "destructive",
      });
    } finally {
      setIsLoggingOut(false);
    }
  };

  const navItems = [
    { path: "/dashboard", icon: Home, label: "Dashboard" },
    { path: "/calendar", icon: Calendar, label: "Calendar" },
    { path: "/classes", icon: BookOpen, label: "Classes", hasDropdown: true },
  ];

  // Find active nav item index
  const activeNavIndex = navItems.findIndex((item) => {
    if (item.path === "/classes") {
      return location.pathname.startsWith("/classes");
    } else if (item.path === "/calendar") {
      return location.pathname.startsWith("/calendar");
    }
    return location.pathname === item.path;
  });

  const { courses } = useCourses();
  const enrolledClasses = courses.filter(
    (course) => course.workflowState === "available"
  );

  // Update active fill position (only on route change)
  useLayoutEffect(() => {
    if (activeNavIndex >= 0 && activeNavIndex < navItemRefs.current.length) {
      const ref = navItemRefs.current[activeNavIndex];
      if (ref) {
        setActiveFillStyle({
          left: ref.offsetLeft,
          width: ref.offsetWidth,
        });
        if (!isFillInitialized) setIsFillInitialized(true);

        // Also initialize underline position to active if not yet set
        if (!isUnderlineInitialized) {
          setUnderlineStyle({
            left: ref.offsetLeft,
            width: ref.offsetWidth,
          });
          setIsUnderlineInitialized(true);
        }
      }
    }
  }, [activeNavIndex, location.pathname]);

  // Update underline position - always snaps from active position to hovered position
  useLayoutEffect(() => {
    // When hovering: move to hovered item
    // When not hovering: move back to active item (so next hover animates FROM active)
    const targetIndex = hoveredNavIndex !== null
      ? hoveredNavIndex
      : (activeNavIndex >= 0 ? activeNavIndex : 0);

    if (targetIndex >= 0 && targetIndex < navItemRefs.current.length) {
      const ref = navItemRefs.current[targetIndex];
      if (ref) {
        setUnderlineStyle({
          left: ref.offsetLeft,
          width: ref.offsetWidth,
        });
        if (!isUnderlineInitialized) setIsUnderlineInitialized(true);
      }
    }
  }, [hoveredNavIndex, activeNavIndex]);

  // Determine if underline should be visible (only when hovering non-active item)
  const isUnderlineVisible = hoveredNavIndex !== null && hoveredNavIndex !== activeNavIndex;

  return (
    <div className="min-h-screen bg-background">
      {/* Top border line */}
      <div className="h-px bg-border" />

      {/* Navigation Menu */}
      <nav className={cn(
        "sticky top-0 z-50 bg-background border-b border-border",
        constrainNav && "max-w-6xl mx-auto"
      )}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <ul ref={ulRef} className="flex flex-row gap-1 relative">
            {/* Active fill indicator - moves on route change/click */}
            {activeNavIndex >= 0 && (
              <div
                className="absolute inset-y-0 bg-foreground pointer-events-none"
                style={{
                  left: 0,
                  width: activeFillStyle.width,
                  transform: `translateX(${activeFillStyle.left}px)`,
                  transition: isFillInitialized ? 'transform 0.1s ease-out, width 0.1s ease-out' : 'none',
                }}
              />
            )}
            {/* Hover underline indicator - always positioned, visibility controlled */}
            <div
              className="absolute bottom-0 h-[3px] bg-foreground pointer-events-none"
              style={{
                left: 0,
                width: underlineStyle.width,
                transform: `translateX(${underlineStyle.left}px)`,
                opacity: isUnderlineVisible ? 1 : 0,
                transition: isUnderlineInitialized
                  ? 'transform 0.12s ease-out, width 0.12s ease-out, opacity 0.04s linear'
                  : 'none',
              }}
            />
            {navItems.map((item, index) => {
              const Icon = item.icon;
              const isActive = item.path === "/classes"
                ? location.pathname.startsWith("/classes")
                : item.path === "/calendar"
                ? location.pathname.startsWith("/calendar")
                : location.pathname === item.path;
              const hasDropdown = (item as any).hasDropdown;

              if (hasDropdown) {
                return (
                  <li
                    key={item.path}
                    ref={(el) => { navItemRefs.current[index] = el; }}
                    className="group relative"
                  >
                    <div
                      className="relative"
                      onMouseEnter={() => {
                        setShowClassesDropdown(true);
                        setHoveredNavIndex(index);
                      }}
                      onMouseLeave={() => {
                        setShowClassesDropdown(false);
                        setHoveredNavIndex(null);
                      }}
                    >
                      <Link
                        to={item.path}
                        className="flex items-center gap-2 px-4 py-2 border border-border cursor-pointer relative"
                      >
                        <Icon className={cn("w-4 h-4 relative z-10 shrink-0", isActive && "text-background")} />
                        <span className={cn("text-sm font-medium relative z-10 whitespace-nowrap", isActive && "text-background")}>
                          {item.label}
                        </span>
                      </Link>
                      {showClassesDropdown && (
                        <div className="absolute top-full left-0 pt-2 z-50">
                          <div className="exposed-card min-w-[240px]">
                            <div className="space-y-1 p-2">
                              {enrolledClasses.map((course, courseIndex) => (
                                <Link
                                  key={course.id}
                                  to={`/classes/${course.id}`}
                                  className="block"
                                  onClick={() => setShowClassesDropdown(false)}
                                >
                                  <div className="fill-hover fill-hover-light flex items-center gap-3 px-3 py-2">
                                    <span className="text-xs text-muted-foreground w-6">
                                      {String(courseIndex + 1).padStart(2, "0")}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate">{course.code}</p>
                                      <p className="text-xs text-muted-foreground truncate">{course.name}</p>
                                    </div>
                                  </div>
                                </Link>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </li>
                );
              }

              return (
                <li
                  key={item.path}
                  ref={(el) => { navItemRefs.current[index] = el; }}
                  className="relative"
                >
                  <Link
                    to={item.path}
                    className="flex items-center gap-2 px-4 py-2 border border-border cursor-pointer relative"
                    onMouseEnter={() => setHoveredNavIndex(index)}
                    onMouseLeave={() => setHoveredNavIndex(null)}
                  >
                    <Icon className={cn("w-4 h-4 relative z-10 shrink-0", isActive && "text-background")} />
                    <span className={cn("text-sm font-medium relative z-10 whitespace-nowrap", isActive && "text-background")}>
                      {item.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Settings and Logout Buttons */}
          <div className="flex items-center gap-1 relative">
            <button
              onClick={() => navigate('/onboarding')}
              className="relative p-2 border border-border bg-background overflow-hidden"
              title="Settings"
              onMouseEnter={() => setHoveredActionButton("settings")}
              onMouseLeave={() => setHoveredActionButton(null)}
            >
              {hoveredActionButton === "settings" && (
                <motion.div
                  layoutId="actionButtonFill"
                  className="absolute inset-0 bg-foreground"
                  initial={false}
                  transition={{
                    type: "tween",
                    duration: 0.15,
                    ease: "easeOut"
                  }}
                />
              )}
              <Settings className={cn(
                "w-4 h-4 relative z-10",
                hoveredActionButton === "settings" && "text-background"
              )} />
            </button>
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="relative p-2 border border-border bg-background disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
              title="Logout"
              onMouseEnter={() => !isLoggingOut && setHoveredActionButton("logout")}
              onMouseLeave={() => setHoveredActionButton(null)}
            >
              {hoveredActionButton === "logout" && (
                <motion.div
                  layoutId="actionButtonFill"
                  className="absolute inset-0 bg-foreground"
                  initial={false}
                  transition={{
                    type: "tween",
                    duration: 0.15,
                    ease: "easeOut"
                  }}
                />
              )}
              <LogOut className={cn(
                "w-4 h-4 relative z-10",
                hoveredActionButton === "logout" && "text-background"
              )} />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto">
        {children}
      </main>
    </div>
  );
};

export default Layout;
