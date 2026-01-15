import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Loader2, AlertTriangle, Palette, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { deleteAccount } from "@/services/api/settings";
import { sessionStorage } from "@/storage/session";
import {
  ThemeOption,
  themeDisplayNames,
  themeDescriptions,
  getPreferences,
  savePreferences,
  applyTheme,
} from "@/lib/preferences";

const themes: ThemeOption[] = ["paper", "sand", "moss", "carbon"];

// Preview colors for each theme
const themePreviewColors: Record<
  ThemeOption,
  { bg: string; accent: string; text: string }
> = {
  paper: { bg: "#f7f3ed", accent: "#2d2518", text: "#2d2518" },
  sand: { bg: "#f5ebe0", accent: "#c67b5c", text: "#5c4a32" },
  moss: { bg: "#f5f2eb", accent: "#6b8e6b", text: "#2d3a2d" },
  carbon: { bg: "#121212", accent: "#e0e0e0", text: "#e0e0e0" },
};

export default function Settings() {
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [currentTheme, setCurrentTheme] = useState<ThemeOption>("paper");

  useEffect(() => {
    const loadUserInfo = async () => {
      const session = await sessionStorage.getSession();
      if (session) {
        setUserId(session.userId);
        setUserEmail(session.email || null);
      }
    };
    loadUserInfo();

    // Load current theme preference
    const prefs = getPreferences();
    setCurrentTheme(prefs.theme);
  }, []);

  const handleThemeChange = (theme: ThemeOption) => {
    setCurrentTheme(theme);
    applyTheme(theme);
    const prefs = getPreferences();
    prefs.theme = theme;
    savePreferences(prefs);
    toast({
      title: "Theme updated",
      description: `Switched to ${themeDisplayNames[theme]} theme`,
    });
  };

  const handleDeleteAccount = async () => {
    if (confirmText !== "DELETE") {
      toast({
        title: "Confirmation required",
        description: 'Please type "DELETE" to confirm account deletion',
        variant: "destructive",
      });
      return;
    }

    if (!userId || !userEmail) {
      toast({
        title: "Error",
        description:
          "Could not find user information. Please try logging in again.",
        variant: "destructive",
      });
      return;
    }

    setIsDeleting(true);

    try {
      await deleteAccount(userId, userEmail);

      // Clear all local storage
      localStorage.clear();
      sessionStorage.clearSession();

      toast({
        title: "Account deleted",
        description:
          "Your account and all associated data have been permanently deleted.",
      });

      // Redirect to login
      setTimeout(() => {
        window.location.href = "/login";
      }, 1500);
    } catch (error: any) {
      console.error("[Settings] Error deleting account:", error);
      toast({
        title: "Deletion failed",
        description:
          error.message || "Failed to delete account. Please try again.",
        variant: "destructive",
      });
      setIsDeleting(false);
    }
  };

  return (
    <Layout>
      <div className="px-5 sm:px-8 py-8">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold mb-6">Settings</h1>

          {/* Appearance */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="w-5 h-5" />
                Appearance
              </CardTitle>
              <CardDescription>
                Customize how the app looks and feels
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-3">Theme</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {themes.map((theme) => {
                      const colors = themePreviewColors[theme];
                      const isSelected = currentTheme === theme;

                      return (
                        <button
                          key={theme}
                          onClick={() => handleThemeChange(theme)}
                          className={`relative p-3 border-2 transition-all ${
                            isSelected
                              ? "border-foreground"
                              : "border-border hover:border-muted-foreground"
                          }`}
                          style={{
                            borderRadius:
                              theme === "paper"
                                ? "0"
                                : theme === "moss"
                                  ? "16px"
                                  : "12px",
                          }}
                        >
                          {/* Theme Preview */}
                          <div
                            className="aspect-video mb-2 flex items-center justify-center overflow-hidden"
                            style={{
                              backgroundColor: colors.bg,
                              borderRadius:
                                theme === "paper"
                                  ? "0"
                                  : theme === "moss"
                                    ? "8px"
                                    : "6px",
                            }}
                          >
                            {/* Mini preview */}
                            <div
                              className="w-2/3 h-2/3 flex flex-col justify-center p-1"
                              style={{
                                backgroundColor:
                                  theme === "carbon" ? "#1e1e1e" : "#fff",
                                borderRadius:
                                  theme === "paper"
                                    ? "0"
                                    : theme === "moss"
                                      ? "4px"
                                      : "3px",
                              }}
                            >
                              <div
                                className="h-1 w-3/4 mb-0.5"
                                style={{
                                  backgroundColor: colors.text,
                                  opacity: 0.6,
                                  borderRadius: "1px",
                                }}
                              />
                              <div
                                className="h-0.5 w-full"
                                style={{
                                  backgroundColor: colors.text,
                                  opacity: 0.2,
                                  borderRadius: "1px",
                                }}
                              />
                            </div>
                          </div>

                          {/* Theme name */}
                          <p className="text-sm font-medium text-center">
                            {themeDisplayNames[theme]}
                          </p>

                          {/* Selected indicator */}
                          {isSelected && (
                            <div
                              className="absolute top-1 right-1 w-5 h-5 bg-foreground text-background flex items-center justify-center"
                              style={{
                                borderRadius: theme === "paper" ? "0" : "50%",
                              }}
                            >
                              <Check className="w-3 h-3" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    {themeDescriptions[currentTheme]}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Danger Zone */}
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                Danger Zone
              </CardTitle>
              <CardDescription>
                Irreversible actions that affect your account
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-1">Delete Account</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Permanently delete your account and all associated data.
                    This action cannot be undone. All your courses, assignments,
                    integrations, and chat history will be permanently removed.
                  </p>

                  <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive">
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete Account
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Are you absolutely sure?
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                          <div className="space-y-3">
                            <p>
                              This action <strong>cannot be undone</strong>.
                              This will permanently delete your account and
                              remove all associated data from our servers.
                            </p>
                            <p>This includes:</p>
                            <ul className="list-disc pl-5 space-y-1">
                              <li>All extracted Canvas data</li>
                              <li>Google Sheets and Notion integrations</li>
                              <li>Chat forum posts and responses</li>
                              <li>Your login credentials and session</li>
                            </ul>
                            <div className="pt-2">
                              <Label
                                htmlFor="confirm-delete"
                                className="text-foreground"
                              >
                                Type <strong>DELETE</strong> to confirm:
                              </Label>
                              <Input
                                id="confirm-delete"
                                value={confirmText}
                                onChange={(e) =>
                                  setConfirmText(e.target.value.toUpperCase())
                                }
                                placeholder="DELETE"
                                className="mt-2"
                                disabled={isDeleting}
                              />
                            </div>
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel
                          disabled={isDeleting}
                          onClick={() => setConfirmText("")}
                        >
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={(e) => {
                            e.preventDefault();
                            handleDeleteAccount();
                          }}
                          disabled={isDeleting || confirmText !== "DELETE"}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {isDeleting ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Deleting...
                            </>
                          ) : (
                            "Delete Account"
                          )}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
