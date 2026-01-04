/**
 * SubscribePage - Subscription/paywall page for unlimited access
 */

import { useParams, useNavigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useState } from 'react';

export default function SubscribePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showComingSoon, setShowComingSoon] = useState(false);

  return (
    <Layout>
      <div className="px-5 sm:px-8 pb-10">
        <Button
          variant="ghost"
          onClick={() => navigate(`/courses/${id}/chat`)}
          className="mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Discussion
        </Button>

        <div className="max-w-2xl mx-auto">
          <header className="text-center mb-12">
            <h1 className="page-header mb-4">Unlock Unlimited Access</h1>
            <p className="page-header-subtitle">
              Get unlimited solution views and premium features
            </p>
          </header>

          <div className="bg-background border border-border rounded-lg p-8 mb-8">
            <h2 className="text-xl font-semibold mb-6">Features</h2>
            <ul className="space-y-4 mb-8">
              <li className="flex items-start gap-3">
                <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Unlimited solution views</p>
                  <p className="text-sm text-muted-foreground">
                    View as many solutions as you need without restrictions
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Priority support</p>
                  <p className="text-sm text-muted-foreground">
                    Get help faster with priority customer support
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Early access to new features</p>
                  <p className="text-sm text-muted-foreground">
                    Be among the first to try new features and improvements
                  </p>
                </div>
              </li>
            </ul>

            <div className="text-center border-t border-border pt-8">
              <div className="mb-4">
                <span className="text-4xl font-bold">$10</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <Button
                onClick={() => setShowComingSoon(true)}
                size="lg"
                className="w-full"
              >
                Continue
              </Button>
            </div>
          </div>
        </div>

        {/* Coming Soon Modal */}
        <Dialog open={showComingSoon} onOpenChange={setShowComingSoon}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Coming Soon</DialogTitle>
              <DialogDescription>
                Payment integration is coming soon. For now, you can continue using the free tier
                with up to 6 solution unlocks.
              </DialogDescription>
            </DialogHeader>
            <Button
              onClick={() => setShowComingSoon(false)}
              className="w-full mt-4"
            >
              Got it
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}

