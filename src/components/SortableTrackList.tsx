"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";

type Song = { position: number; title: string; artist: string };

type SortableTrackListProps<T extends Song> = {
  tracks: T[];
  /** False while there's nothing to reorder or an edit is in flight. */
  canReorder: boolean;
  /** Called with every song's position in the new order. */
  onReorder: (positions: number[]) => void;
  renderRow: (track: T, index: number) => ReactNode;
};

/**
 * The playlist's songs, which can be dragged into a new order by their handle
 * with a mouse or finger, or moved with the keyboard: focus a handle, press
 * Space, use the arrow keys, then Space again to drop (Escape cancels).
 */
export function SortableTrackList<T extends Song>({ tracks, canReorder, onReorder, renderRow }: SortableTrackListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = tracks.map((track) => track.position);
  const byPosition = new Map(tracks.map((track) => [track.position, track]));
  const describe = (id: number | string) => {
    const track = byPosition.get(Number(id));
    return track ? `${track.title} by ${track.artist}` : "The song";
  };
  const spot = (id: number | string) => ids.indexOf(Number(id)) + 1;

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${describe(active.id)}, song ${spot(active.id)} of ${ids.length}.`,
    onDragOver: ({ active, over }) => (over ? `${describe(active.id)} moved to spot ${spot(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `${describe(active.id)} dropped at spot ${spot(over.id)}.` : `${describe(active.id)} dropped.`),
    onDragCancel: ({ active }) => `Moving cancelled. ${describe(active.id)} is back at spot ${spot(active.id)}.`,
  };

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To move a song, press Space, then use the up and down arrow keys. Press Space again to drop it, or Escape to cancel.",
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="mt-10 flex flex-col">
          {tracks.map((track, index) => (
            <SortableRow key={track.position} track={track} canReorder={canReorder}>
              {renderRow(track, index)}
            </SortableRow>
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ track, canReorder, children }: { track: Song; canReorder: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: track.position,
    disabled: !canReorder,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group relative flex items-center gap-4 border-b border-border/60 bg-background py-3 last:border-b-0 ${
        isDragging ? "z-10 rounded-lg shadow-lg ring-1 ring-accent/60" : ""
      }`}
    >
      {children}
      {canReorder && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Move ${track.title} by ${track.artist}`}
          title="Drag to reorder"
          className="flex h-9 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-text-secondary hover:text-text-primary focus-visible:opacity-100 active:cursor-grabbing sm:opacity-0 sm:group-hover:opacity-100"
        >
          <GripVertical size={18} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}
