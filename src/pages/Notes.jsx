import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { StickyNote, Loader2, Plus } from "lucide-react";
import { base44 } from "@/api/base44Client";
import NoteCard from "@/components/notes/NoteCard";

const COLORS = ["default", "amber", "rose", "emerald", "blue", "violet"];

export default function Notes() {
  const [notes, setNotes] = useState(null);
  const [activeColor, setActiveColor] = useState("default");

  const load = useCallback(async () => {
    const data = await base44.entities.Note.list("-created_date", 100);
    setNotes(data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    const created = await base44.entities.Note.create({
      title: "Nova nota",
      content: "",
      color: activeColor,
      pinned: false,
    });
    setNotes((prev) => (prev ? [created, ...prev] : [created]));
  };

  const handleUpdate = async (id, patch) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    await base44.entities.Note.update(id, patch);
  };

  const handleDelete = async (id) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    await base44.entities.Note.delete(id);
  };

  const sorted = [...(notes || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned));

  return (
    <div className="mx-auto max-w-4xl px-5 py-10 sm:py-12">
      <header className="mb-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground text-background">
            <StickyNote className="h-5 w-5" />
          </div>
          <span className="text-sm font-medium tracking-tight text-muted-foreground">Suas notas</span>
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">Bloco de ideias</h1>
        <p className="mt-3 text-sm text-muted-foreground">Capture pensamentos rápidos e referências.</p>
      </header>

      {/* Add bar */}
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <button
          onClick={handleAdd}
          className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Nova nota
        </button>
        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => {
            const colorClass = {
              default: "bg-card border-border",
              amber: "bg-amber-100 border-amber-300",
              rose: "bg-rose-100 border-rose-300",
              emerald: "bg-emerald-100 border-emerald-300",
              blue: "bg-blue-100 border-blue-300",
              violet: "bg-violet-100 border-violet-300",
            }[c];
            return (
              <button
                key={c}
                onClick={() => setActiveColor(c)}
                className={`h-6 w-6 rounded-full border-2 transition-transform ${colorClass} ${
                  activeColor === c ? "scale-110 ring-2 ring-foreground/20 ring-offset-1" : ""
                }`}
                aria-label={`Cor ${c}`}
              />
            );
          })}
        </div>
      </div>

      {/* Grid */}
      {!notes ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <StickyNote className="h-7 w-7 text-muted-foreground" />
          </div>
          <h3 className="mt-5 text-base font-semibold">Sem notas ainda</h3>
          <p className="mt-1 text-sm text-muted-foreground">Crie sua primeira nota acima.</p>
        </div>
      ) : (
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4">
          <AnimatePresence>
            {sorted.map((note) => (
              <NoteCard key={note.id} note={note} onUpdate={handleUpdate} onDelete={handleDelete} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}