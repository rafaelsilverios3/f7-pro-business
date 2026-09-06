import React, { useState } from "react";
import { motion } from "framer-motion";
import { Check, Trash2, Calendar, Circle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isPast, isToday, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

const PRIORITY_STYLES = {
  high: { dot: "bg-rose-400", label: "Alta", ring: "group-hover:ring-rose-400/30" },
  medium: { dot: "bg-amber-400", label: "Média", ring: "group-hover:ring-amber-400/30" },
  low: { dot: "bg-emerald-400", label: "Baixa", ring: "group-hover:ring-emerald-400/30" },
};

const STATUS_ICONS = {
  todo: Circle,
  in_progress: Clock,
  done: Check,
};

export default function TaskItem({ task, onToggle, onDelete, onCycleStatus }) {
  const [removing, setRemoving] = useState(false);
  const isDone = task.status === "done";
  const prio = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.medium;
  const StatusIcon = STATUS_ICONS[task.status] || Circle;

  const dueInfo = task.due_date
    ? (() => {
        const d = parseISO(task.due_date);
        const overdue = !isDone && isPast(d) && !isToday(d);
        return { date: d, overdue };
      })()
    : null;

  const handleDelete = () => {
    setRemoving(true);
    setTimeout(() => onDelete(task.id), 200);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: removing ? 0 : 1, y: removing ? -10 : 0, height: removing ? 0 : "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "group relative flex items-start gap-3.5 rounded-2xl border border-border bg-card p-4 shadow-sm transition-all hover:shadow-md",
        isDone && "opacity-60"
      )}
    >
      {/* Status toggle */}
      <button
        onClick={() => onCycleStatus(task)}
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all",
          isDone
            ? "border-foreground bg-foreground text-background"
            : task.status === "in_progress"
            ? "border-amber-400 bg-amber-400/10"
            : "border-border hover:border-foreground/50"
        )}
        aria-label="Alternar status"
      >
        {isDone ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : task.status === "in_progress" ? <Clock className="h-3 w-3 text-amber-500" /> : null}
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className={cn("text-sm font-medium leading-snug", isDone && "line-through text-muted-foreground")}>
            {task.title}
          </p>
          <button
            onClick={handleDelete}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            aria-label="Excluir tarefa"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {task.description && (
          <p className={cn("mt-1 text-xs leading-relaxed text-muted-foreground", isDone && "line-through")}>
            {task.description}
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <span className={cn("h-1.5 w-1.5 rounded-full", prio.dot)} />
            {prio.label}
          </span>
          {dueInfo && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium",
                dueInfo.overdue ? "bg-rose-500/10 text-rose-500" : "bg-muted/60 text-muted-foreground"
              )}
            >
              <Calendar className="h-3 w-3" />
              {format(dueInfo.date, "dd 'de' MMM", { locale: ptBR })}
              {dueInfo.overdue && " · atrasado"}
            </span>
          )}
          {task.status === "in_progress" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-600">
              <Clock className="h-3 w-3" /> Em progresso
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}