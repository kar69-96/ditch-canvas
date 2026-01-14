import { Link, useLocation, useNavigate } from "react-router-dom";
import { Home, Calendar, BookOpen, LogOut, Bot, Settings } from "lucide-react";
import { useCourses } from "@/hooks/useCanvasData";
import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { logout } from "@/services/mockApi/auth";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import FeedbackModal from "@/components/FeedbackModal";
import { sessionStorage } from "@/storage/session";
import { userDatabase } from "@/services/database/userDatabase";

const Layout = ({
  children,
  constrainNav = false,
}: {
  children: React.ReactNode;
  constrainNav?: boolean;
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [showClassesDropdown, setShowClassesDropdown] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [hoveredNavIndex, setHoveredNavIndex] = useState<number | null>(null);
  const [hoveredActionButton, setHoveredActionButton] = useState<
    "feedback" | "settings" | "logout" | null
  >(null);
  const [userName, setUserName] = useState<string | undefined>(undefined);
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined);
  const navItemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const ulRef = useRef<HTMLUListElement | null>(null);

  // Load user info for feedback
  useEffect(() => {
    async function loadUserInfo() {
      const session = await sessionStorage.getSession();
      if (session?.email) {
        setUserEmail(session.email);
        const user = await userDatabase.getUserByEmail(session.email);
        if (user) {
          setUserName(user.firstName || user.student || undefined);
        }
      }
    }
    loadUserInfo();
  }, []);

  // Active fill indicator (moves on route change/click) - uses framer-motion for smooth snapping
  const [activeFillStyle, setActiveFillStyle] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });
  const [isFillInitialized, setIsFillInitialized] = useState(false);

  // Hover underline indicator - always tracks a position, visibility controlled separately
  const [underlineStyle, setUnderlineStyle] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });
  const [isUnderlineInitialized, setIsUnderlineInitialized] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      toast({
        title: "Logged out",
        description: "You have been successfully logged out",
      });
      // Refresh the page and redirect to login
      window.location.href = "/login";
    } catch (error: any) {
      console.error("Error logging out:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to log out",
        variant: "destructive",
      });
      setIsLoggingOut(false);
    }
  };

  const navItems = [
    { path: "/dashboard", icon: Home, label: "Dashboard" },
    { path: "/calendar", icon: Calendar, label: "Calendar" },
    { path: "/courses", icon: BookOpen, label: "Classes", hasDropdown: true },
    { path: "/assistant", icon: Bot, label: "Tabus" },
  ];

  // Find active nav item index
  const activeNavIndex = navItems.findIndex((item) => {
    if (item.path === "/courses") {
      return location.pathname.startsWith("/courses");
    } else if (item.path === "/calendar") {
      return location.pathname.startsWith("/calendar");
    } else if (item.path === "/assistant") {
      return location.pathname.startsWith("/assistant");
    } else if (item.path === "/dashboard") {
      return location.pathname === "/dashboard";
    }
    return location.pathname === item.path;
  });

  const { courses } = useCourses();
  const enrolledClasses = courses.filter(
    (course) => course.workflowState === "available",
  );

  // Update active fill position (only on route change/click) - snaps from current position
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
  }, [
    activeNavIndex,
    location.pathname,
    isFillInitialized,
    isUnderlineInitialized,
  ]);

  // Update underline position - always snaps from active position to hovered position
  useLayoutEffect(() => {
    // When hovering: move to hovered item
    // When not hovering: move back to active item (so next hover animates FROM active)
    const targetIndex =
      hoveredNavIndex !== null
        ? hoveredNavIndex
        : activeNavIndex >= 0
          ? activeNavIndex
          : 0;

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
  }, [hoveredNavIndex, activeNavIndex, isUnderlineInitialized]);

  // Determine if underline should be visible (only when hovering non-active item)
  const isUnderlineVisible =
    hoveredNavIndex !== null && hoveredNavIndex !== activeNavIndex;

  return (
    <div className="min-h-screen bg-background">
      {/* Top border line */}
      <div className="h-px bg-border" />

      {/* Navigation Menu */}
      <nav
        className={cn(
          "z-50 bg-background border-b border-border",
          constrainNav && "max-w-6xl mx-auto",
        )}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <ul ref={ulRef} className="flex flex-row gap-1 relative">
            {/* Active fill indicator - moves on route change/click with smooth snapping */}
            {/* Z-index: above border (z-10) but below text (z-20) */}
            {activeNavIndex >= 0 && isFillInitialized && (
              <motion.div
                layoutId="navActiveFill"
                className="absolute inset-y-0 bg-foreground pointer-events-none z-10"
                style={{
                  left: activeFillStyle.left,
                  width: activeFillStyle.width,
                }}
                initial={false}
                transition={{
                  type: "tween",
                  duration: 0.1,
                  ease: "easeOut",
                }}
              />
            )}
            {/* Hover underline indicator - snaps on hover, always positioned */}
            {/* Z-index: above border (z-10) and fill (z-10), but below text (z-20) */}
            {/* Uses same snapping effect as weekly view underline */}
            {isUnderlineInitialized && (
              <motion.div
                className="absolute bottom-0 h-[2px] bg-foreground pointer-events-none z-[11]"
                animate={{
                  left: underlineStyle.left,
                  width: underlineStyle.width,
                  opacity: isUnderlineVisible ? 1 : 0,
                }}
                initial={false}
                transition={{
                  type: "tween",
                  duration: 0.1,
                  ease: "easeOut",
                }}
              />
            )}
            {navItems.map((item, index) => {
              const Icon = item.icon;
              const isActive =
                item.path === "/courses"
                  ? location.pathname.startsWith("/courses")
                  : item.path === "/calendar"
                    ? location.pathname.startsWith("/calendar")
                    : item.path === "/assistant"
                      ? location.pathname.startsWith("/assistant")
                      : item.path === "/dashboard"
                        ? location.pathname === "/dashboard"
                        : location.pathname === item.path;
              const hasDropdown = (item as any).hasDropdown;

              if (hasDropdown) {
                return (
                  <li
                    key={item.path}
                    ref={(el) => {
                      navItemRefs.current[index] = el;
                    }}
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
                        {/* Border is on the Link element (lowest layer, z-0) */}
                        {/* Fill and underline are z-10, text is z-20 */}
                        <Icon
                          className={cn(
                            "w-4 h-4 relative z-20 shrink-0",
                            isActive && "text-background",
                          )}
                        />
                        <span
                          className={cn(
                            "text-sm font-medium relative z-20 whitespace-nowrap",
                            isActive && "text-background",
                          )}
                        >
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
                                  to={`/courses/${course.id}`}
                                  className="block"
                                  onClick={() => setShowClassesDropdown(false)}
                                >
                                  <div className="fill-hover fill-hover-light flex items-center gap-3 px-3 py-2">
                                    <span className="text-xs text-muted-foreground w-6">
                                      {String(courseIndex + 1).padStart(2, "0")}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate">
                                        {course.code}
                                      </p>
                                      <p className="text-xs text-muted-foreground truncate">
                                        {course.name}
                                      </p>
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
                  ref={(el) => {
                    navItemRefs.current[index] = el;
                  }}
                  className="relative"
                >
                  <Link
                    to={item.path}
                    className="flex items-center gap-2 px-4 py-2 border border-border cursor-pointer relative"
                    onMouseEnter={() => setHoveredNavIndex(index)}
                    onMouseLeave={() => setHoveredNavIndex(null)}
                  >
                    {/* Border is on the Link element (lowest layer, z-0) */}
                    {/* Fill and underline are z-10, text is z-20 */}
                    <Icon
                      className={cn(
                        "w-4 h-4 relative z-20 shrink-0",
                        isActive && "text-background",
                      )}
                    />
                    <span
                      className={cn(
                        "text-sm font-medium relative z-20 whitespace-nowrap",
                        isActive && "text-background",
                      )}
                    >
                      {item.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Action Buttons */}
          <div className="flex items-center gap-1 relative">
            {/* Feedback Button */}
            <FeedbackModal
              userName={userName}
              userEmail={userEmail}
              isHovered={hoveredActionButton === "feedback"}
              onHover={(hovered) =>
                setHoveredActionButton(hovered ? "feedback" : null)
              }
            />

            {/* Settings Button */}
            <Link
              to="/settings"
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
                    ease: "easeOut",
                  }}
                />
              )}
              <Settings
                className={cn(
                  "w-4 h-4 relative z-10",
                  hoveredActionButton === "settings" && "text-background",
                )}
              />
            </Link>

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="relative p-2 border border-border bg-background disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
              title="Logout"
              onMouseEnter={() =>
                !isLoggingOut && setHoveredActionButton("logout")
              }
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
                    ease: "easeOut",
                  }}
                />
              )}
              <LogOut
                className={cn(
                  "w-4 h-4 relative z-10",
                  hoveredActionButton === "logout" && "text-background",
                )}
              />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto">{children}</main>
    </div>
  );
};

export default Layout;
