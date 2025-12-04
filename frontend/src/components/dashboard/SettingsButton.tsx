import { Settings } from "lucide-react";

interface SettingsButtonProps {
  onClick: () => void;
}

export function SettingsButton({ onClick }: SettingsButtonProps) {
  return (
    <button
      onClick={onClick}
      className="fill-hover fill-hover-light p-2 border border-border"
      aria-label="Settings"
    >
      <Settings className="w-4 h-4 text-muted-foreground" />
    </button>
  );
}
