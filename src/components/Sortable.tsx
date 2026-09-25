import {
  closestCenter,
  DndContext,
  pointerWithin,
  type CollisionDetection,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { arrayMove } from '../domain/menu-order.ts'

/**
 * Drag and drop for the menu builder.
 *
 * Mouse, touch and keyboard: the owner arranges the menu on a phone as often
 * as on a laptop. On touch a drag starts after a short press on the handle, so
 * a flick still scrolls the page. Only the handle starts a drag — the rest of a
 * row stays free for typing and tapping.
 */
export function useDragSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
}

/**
 * What a drop lands on: whatever is under the pointer. Rows here can be tall —
 * an option group carries its options — and "nearest centre" alone would make
 * the owner drag far past a tall row before anything moves. The keyboard has
 * no pointer, so it falls back to nearest centre.
 */
export const pointerFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length > 0 ? hits : closestCenter(args)
}

type HandleProps = ReturnType<typeof useSortable>['listeners'] & ReturnType<typeof useSortable>['attributes']

/** The grip a row is dragged by. Space or Enter picks it up from the keyboard. */
export function DragHandle({ label, handle }: { label: string; handle: HandleProps }) {
  return (
    <button
      type="button"
      aria-label={label}
      title="Drag to reorder"
      {...handle}
      // Without this a touch on the handle scrolls the page instead of dragging.
      style={{ touchAction: 'none' }}
      className="grid size-10 shrink-0 cursor-grab place-items-center text-slate-400 hover:text-ink active:cursor-grabbing"
    >
      <GripVertical aria-hidden="true" className="size-5" />
    </button>
  )
}

/** A row that can be dragged: its node, the style that moves it, and its handle. */
export function useSortableRow(id: string) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : undefined,
    boxShadow: isDragging ? '0 8px 24px rgba(24,33,29,0.18)' : undefined,
  }
  return { setNodeRef, style, handle: { ...attributes, ...listeners } as HandleProps, isDragging }
}

/**
 * A single list the owner can reorder — an item's option groups, a group's
 * options. Shows the new order at once and saves it; if saving fails, it goes
 * back to the order the server has.
 */
export function SortableList({
  ids,
  onReorder,
  children,
}: {
  ids: string[]
  onReorder: (ids: string[]) => Promise<boolean>
  children: (ids: string[]) => ReactNode
}) {
  const sensors = useDragSensors()
  // Shown until the server's order catches up: it is dropped as soon as the ids
  // from the server change, whether that is this save arriving or anything else.
  const [pending, setPending] = useState<{ base: string; order: string[] } | null>(null)
  const base = ids.join(',')
  const order = pending && pending.base === base ? pending.order : ids

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)))
    setPending({ base, order: next })
    void onReorder(next).then((saved) => {
      if (!saved) setPending(null)
    })
  }

  return (
    <DndContext sensors={sensors} collisionDetection={pointerFirst} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        {children(order)}
      </SortableContext>
    </DndContext>
  )
}
