import { Checkbox } from "@/components/ui/checkbox";

interface TodoItemProps {
  text: string;
  completed: boolean;
  onToggle: () => void;
}

const TodoItem = ({ text, completed, onToggle }: TodoItemProps) => {
  return (
    <div className="flex items-center gap-3 py-3 group">
      <Checkbox
        checked={completed}
        onCheckedChange={onToggle}
        className="border-white/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
      />
      <span
        className={`text-sm  ${
          completed
            ? "text-foreground/50 line-through"
            : "text-foreground/80 group-hover:text-foreground"
        }`}
      >
        {text}
      </span>
    </div>
  );
};

export default TodoItem;
