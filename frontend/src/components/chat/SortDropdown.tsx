/**
 * SortDropdown component for sorting posts
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, Clock, MessageSquare, TrendingUp } from 'lucide-react';
import type { SortMode } from '@/types/chat';

interface SortDropdownProps {
  value: SortMode;
  onChange: (value: SortMode) => void;
  className?: string;
}

const SORT_OPTIONS: { value: SortMode; label: string; icon: React.ReactNode }[] = [
  { value: 'default', label: 'Default', icon: <ArrowUpDown className="w-4 h-4" /> },
  { value: 'newest', label: 'Newest First', icon: <Clock className="w-4 h-4" /> },
  { value: 'responses', label: 'Most Responses', icon: <MessageSquare className="w-4 h-4" /> },
  { value: 'score', label: 'Highest Score', icon: <TrendingUp className="w-4 h-4" /> },
];

export function SortDropdown({ value, onChange, className }: SortDropdownProps) {
  const currentOption = SORT_OPTIONS.find((opt) => opt.value === value) || SORT_OPTIONS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={className}>
          {currentOption.icon}
          <span className="ml-2">{currentOption.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SORT_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onChange(option.value)}
            className="flex items-center gap-2"
          >
            {option.icon}
            <span>{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

