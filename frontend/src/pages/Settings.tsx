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
import { Trash2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { deleteAccount } from "@/services/api/settings";
import { sessionStorage } from "@/storage/session";

export default function Settings() {
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const loadUserInfo = async () => {
      const session = await sessionStorage.getSession();
      if (session) {
        setUserId(session.userId);
        setUserEmail(session.email || null);
      }
    };
    loadUserInfo();
  }, []);

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
