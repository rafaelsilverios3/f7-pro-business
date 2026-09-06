import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ListTodo, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import TaskForm from "@/components/tasks/TaskForm";
import TaskItem from "@/components/tasks/TaskItem";
import EmptyState from "@/components/tasks/EmptyState";
import { cn } from "@/lib/utils";

const FILTERS = [
  { value: "all", label: "Todas" },
  { value: "todo", label: "A fazer" },
  { value: "in_progress", label: "Em progresso" },
  { value: "done", label: "Concluídas" },
];

const STATUS_CYCLE = { todo: "in_progress", in_progress: "done", done: "todo" };

export default function Home() {
  const [tasks, setTasks] = useState(null);
  const [filter, setFilter] = useState("all");

  const loadTasks = useCallback(async () => {
    const data = await base44.entities.Task.list("-created_date", 100);
    setTasks(data);
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleAdd = async (payload) => {
    const created = await base44.entities.Task.create(payload);
    setTasks((prev) => (prev ? [created, ...prev] : [created]));
  };

  const handleCycleStatus = async (task) => {
    const next = STATUS_CYCLE[task.status] || "todo";
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: next } : t)));
    await base44.entities.Task.update(task.id, { status: next });
  };

  const handleDelete = async (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await base44.entities.Task.delete(id);
  };

  const counts = {
    all: tasks?.length || 0,
    todo: tasks?.filter((t) => t.status === "todo").length || 0,
    in_progress: tasks?.filter((t) => t.status === "in_progress").length || 0,
    done: tasks?.filter((t) => t.status === "done").length || 0,
  };

  const filtered = (tasks || []).filter((t) => filter === "all" || t.status === filter);
  const progress = counts.all > 0 ? Math.round((counts.done / counts.all) * 100) : 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:py-16">
        {/* Header */}
        <header className="mb-10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground text-background">
              <ListTodo className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium tracking-tight text-muted-foreground">Minhas tarefas</span>
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
            O que vamos<br />concluir hoje?
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Organize seu dia com clareza e foco.
          </p>
        </header>

        {/* Progress bar */}
        {tasks && tasks.length > 0 && (
          <div className="mb-8">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">Progresso do dia</span>
              <span className="font-semibold">{progress}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="h-full rounded-full bg-foreground"
              />
            </div>
          </div>
        )}

        {/* Add form */}
        <div className="mb-6">
          <TaskForm onAdd={handleAdd} />
        </div>

        {/* Filters */}
        {tasks && tasks.length > 0 && (
          <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all",
                  filter === f.value
                    ? "bg-foreground text-background"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted"
                )}
              >
                {f.label}
                <span className={cn("text-[10px]", filter === f.value ? "text-background/60" : "text-muted-foreground/60")}>
                  {counts[f.value]}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* List */}
        <div className="space-y-2.5">
          {!tasks ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState filtered={filter !== "all"} />
          ) : (
            <AnimatePresence>
              {filtered.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onCycleStatus={handleCycleStatus}
                  onDelete={handleDelete}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}