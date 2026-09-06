import React, { useState } from "react";
import { motion } from "framer-motion";
import { Pin, PinOff, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const COLORS = {
  default: "bg-card",
  amber: "bg-amber-50 border-amber-200/60",
  rose: "bg-rose-50 border-rose-200/60",
  emerald: "bg-emerald-50 border-emerald-200/60",
  blue: "bg-blue-50 border-blue-200/60",
  violet: "bg-violet-50 border-violet-200/60",
};

export default function NoteCard({ note, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content || "");

  const save = async () => {
    if (!title.trim()) return;
    setEditing(false);
    if (title !== note.title || content !== note.content) {
      await onUpdate(note.id, { title: title.trim(), content: content.trim() });
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "group relative flex flex-col rounded-2xl border border-border p-4 shadow-sm transition-shadow hover:shadow-md",
        COLORS[note.color] || COLORS.default
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === "Enter" && save()}
            autoFocus
            className="w-full bg-transparent text-sm font-semibold outline-none"
            placeholder="Título"
          />
        ) : (
          <h3
            onClick={() => setEditing(true)}
            className="cursor-text text-sm font-semibold leading-snug"
          >
            {note.title}
          </h3>
        )}
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => onUpdate(note.id, { pinned: !note.pinned })}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-foreground/5"
          >
            {note.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => onDelete(note.id)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {editing ? (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={save}
          rows={4}
          className="mt-2 w-full resize-none bg-transparent text-xs leading-relaxed text-muted-foreground outline-none"
          placeholder="Escreva algo..."
        />
      ) : (
        <p
          onClick={() => setEditing(true)}
          className="mt-1.5 cursor-text whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground line-clamp-[8]"
        >
          {note.content || "Toque para escrever..."}
        </p>
      )}
    </motion.div>
  );
}