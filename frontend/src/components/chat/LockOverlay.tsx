/**
 * LockOverlay component for locked responses
 */

import { useState } from 'react';
import { Lock, MessageSquare, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Response } from '@/types/chat';

interface LockOverlayProps {
  response: Response;
  onUnlock: () => void;
  onPay: () => void;
  onRespond: () => void;
}

export function LockOverlay({
  response,
  onUnlock,
  onPay,
  onRespond,
}: LockOverlayProps) {
  const [showMessage, setShowMessage] = useState(false);

  return (
    <div className="relative">
      {/* Blurred content */}
      <div className="blur-sm select-none pointer-events-none">
        <p className="text-foreground/80">{response.body}</p>
      </div>

      {/* Overlay */}
      <div
        className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg cursor-pointer"
        onClick={() => setShowMessage(true)}
      >
        {!showMessage ? (
          <div className="text-center">
            <Lock className="w-12 h-12 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Click to unlock</p>
          </div>
        ) : (
          <div className="bg-background border border-border rounded-lg p-6 max-w-sm mx-4 shadow-lg">
            <h3 className="font-semibold mb-2">Unlock Response</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Respond to this comment to unlock, or subscribe for unlimited access.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => {
                  onRespond();
                  setShowMessage(false);
                }}
                className="w-full"
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                Respond to Comment
              </Button>
              <Button
                onClick={() => {
                  onPay();
                  setShowMessage(false);
                }}
                variant="outline"
                className="w-full"
              >
                <CreditCard className="w-4 h-4 mr-2" />
                Join Now ($10/month)
              </Button>
              <Button
                onClick={() => setShowMessage(false)}
                variant="ghost"
                size="sm"
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

