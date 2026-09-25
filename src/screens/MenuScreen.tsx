import {
  closestCenter,
  DndContext,
  pointerWithin,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Badge, Panel, SectionHeading } from '../components/primitives.tsx'
import { DragHandle, SortableList, useDragSensors, useSortableRow } from '../components/Sortable.tsx'
import type { MenuEdit, VistaStore } from '../data/store.ts'
import {
  arrayMove,
  categoryOf,
  layoutOf,
  moveItem,
  reorderWithin,
  type Layout,
} from '../domain/menu-order.ts'
import { isCommon, suggestGroups, type GroupSuggestion } from '../domain/menu-suggestions.ts'
import { formatRinggit, parseRinggitToSen } from '../domain/money.ts'
import type { Brand, Category, ModifierGroup, Product } from '../domain/types.ts'

/**
 * The menu: live prices and availability, and — for the real books — the
 * builder a new business uses to set up what it sells.
 *
 * Nothing here can change a sale already made. Every sale keeps the name,
 * price and brand it was rung up with; an item that has been sold can be
 * hidden but never deleted.
 */

type Edit = (edit: MenuEdit) => Promise<boolean>

/** What an item shows when it has no picture: its brand colour and initials. */
export function ProductThumb({ product, brand }: { product: Product; brand?: Brand }) {
  if (product.imageUrl) {
    return (
      <img src={product.imageUrl} alt="" className="size-12 shrink-0 object-cover ring-1 ring-line" />
    )
  }
  const initials = product.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase()
  return (
    <span
      aria-hidden="true"
      className="grid size-12 shrink-0 place-items-center text-sm font-black ring-1 ring-line"
      style={{ backgroundColor: brand?.softColour ?? '#eef1f0', color: brand?.colour ?? '#101826' }}
    >
      {initials}
    </span>
  )
}

function IconButton({
  label,
  onClick,
  children,
  tone = 'default',
}: {
  label: string
  onClick: () => void
  children: ReactNode
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid size-10 shrink-0 place-items-center border border-line bg-surface hover:bg-canvas ${
        tone === 'danger' ? 'text-critical' : 'text-slate-600'
      }`}
    >
      {children}
    </button>
  )
}

/** A one-field form: a name and a button. Clears itself once the change is saved. */
function AddByName({
  label,
  placeholder,
  onAdd,
}: {
  label: string
  placeholder: string
  onAdd: (name: string) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    if (await onAdd(trimmed)) setName('')
    setBusy(false)
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-wrap gap-2">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        maxLength={80}
        className="vista-control min-w-0 flex-1 px-3 text-sm"
      />
      <button
        type="submit"
        disabled={!name.trim() || busy}
        className="vista-button-secondary flex min-h-11 items-center gap-1 px-3 disabled:opacity-50"
      >
        <Plus aria-hidden="true" className="size-4" /> {label}
      </button>
    </form>
  )
}

/** A name that saves when the field is left. */
function InlineName({
  name,
  label,
  onSave,
}: {
  name: string
  label: string
  onSave: (next: string) => void
}) {
  const [draft, setDraft] = useState(name)
  return (
    <input
      value={draft}
      aria-label={label}
      maxLength={80}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim()
        if (next && next !== name) onSave(next)
        else setDraft(name)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      className="vista-control min-w-0 flex-1 px-3 text-sm font-black"
    />
  )
}

/**
 * Pick a category. With more than one brand the list is grouped by brand,
 * because moving an item to another brand's category moves its future sales
 * to that brand too.
 */
function CategorySelect({
  value,
  categories,
  brands,
  label,
  onChange,
}: {
  value: string
  categories: Category[]
  brands: Brand[]
  label: string
  onChange: (categoryId: string) => void
}) {
  const options = (list: Category[]) =>
    list.map((category) => (
      <option key={category.id} value={category.id}>
        {category.name}
      </option>
    ))
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      className="vista-control max-w-44 px-2 text-sm"
    >
      {brands.length > 1
        ? brands.map((brand) => (
            <optgroup key={brand.id} label={brand.name}>
              {options(categories.filter((category) => category.brandId === brand.id))}
            </optgroup>
          ))
        : options(categories)}
    </select>
  )
}

/** "Regular · Large +RM 1.50 · …" — enough to recognise a group at a glance. */
function optionsPreview(group: ModifierGroup): string {
  const shown = group.options
    .slice(0, 3)
    .map((option) => (option.priceSen > 0 ? `${option.name} +${formatRinggit(option.priceSen)}` : option.name))
  return group.options.length > 3 ? `${shown.join(' · ')} · +${group.options.length - 3} more` : shown.join(' · ')
}

/**
 * Option groups the category's other items use, to copy onto this one. In the
 * new-item form they are tick boxes; in the editor, one tap adds each.
 */
function Suggestions({
  categoryName,
  suggestions,
  children,
}: {
  categoryName: string
  suggestions: GroupSuggestion[]
  children: (suggestion: GroupSuggestion) => ReactNode
}) {
  if (suggestions.length === 0) return null
  return (
    <div className="border border-dashed border-line bg-surface p-3">
      <p className="vista-field-label">Suggested from {categoryName}</p>
      <ul className="mt-2 space-y-2">
        {suggestions.map((suggestion) => (
          <li key={suggestion.group.id} className="flex flex-wrap items-center gap-2">
            {children(suggestion)}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black">{suggestion.group.name}</span>
              <span className="block truncate text-xs text-muted">{optionsPreview(suggestion.group)}</span>
            </span>
            <span className="font-mono text-[0.65rem] font-bold text-muted">
              on {suggestion.usedBy} of {suggestion.of} items
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

function BrandsPanel({ store, edit }: { store: VistaStore; edit: Edit }) {
  const [colour, setColour] = useState('#087f8c')

  return (
    <Panel>
      <SectionHeading
        title="Brands"
        hint="Every item belongs to a brand. One is enough for most businesses; partner settlement needs exactly two."
      />
      <ul className="divide-y divide-slate-100">
        {store.brands.map((brand) => (
          <li key={brand.id} className="flex flex-wrap items-center gap-2 py-2">
            <input
              type="color"
              value={brand.colour}
              aria-label={`${brand.name} colour`}
              onChange={(event) => void edit({ kind: 'updateBrand', id: brand.id, colour: event.target.value })}
              className="size-10 shrink-0 cursor-pointer border border-line bg-surface p-0.5"
            />
            <InlineName
              key={`${brand.id}:${brand.name}`}
              name={brand.name}
              label="Brand name"
              onSave={(name) => void edit({ kind: 'updateBrand', id: brand.id, name })}
            />
            {store.brands.length > 1 ? (
              <IconButton
                label={`Delete ${brand.name}`}
                tone="danger"
                onClick={() => {
                  if (window.confirm(`Delete the brand "${brand.name}"? Only possible while it has no categories or sales.`)) {
                    void edit({ kind: 'deleteBrand', id: brand.id })
                  }
                }}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </IconButton>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="color"
          value={colour}
          aria-label="New brand colour"
          onChange={(event) => setColour(event.target.value)}
          className="size-11 shrink-0 cursor-pointer border border-line bg-surface p-0.5"
        />
        <div className="min-w-0 flex-1">
          <AddByName
            label="Add brand"
            placeholder="Brand name, e.g. Drinks"
            onAdd={(name) => edit({ kind: 'addBrand', name, colour })}
          />
        </div>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function NewProductForm({
  category,
  products,
  edit,
  onDone,
}: {
  category: Category
  products: Product[]
  edit: Edit
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [busy, setBusy] = useState(false)
  // Read once when the form opens: the category's options, with the ones most
  // of its items share already ticked.
  const [suggestions] = useState(() => suggestGroups(products, category.id))
  const [copying, setCopying] = useState<Set<string>>(
    () => new Set(suggestions.filter(isCommon).map((suggestion) => suggestion.group.id)),
  )
  const priceSen = parseRinggitToSen(price)
  const canSave = name.trim().length > 0 && priceSen !== null && priceSen >= 0

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSave || priceSen === null || busy) return
    setBusy(true)
    const saved = await edit({
      kind: 'addProduct',
      categoryId: category.id,
      name: name.trim(),
      description: description.trim(),
      basePriceSen: priceSen,
      imageUrl: imageUrl.trim() || null,
      copyGroupIds: [...copying],
    })
    setBusy(false)
    if (saved) onDone()
  }

  function toggle(groupId: string) {
    setCopying((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-3 space-y-3 border border-line bg-canvas p-3">
      <p className="text-sm font-black">New item in {category.name}</p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <label className="block">
          <span className="vista-field-label">Name</span>
          <input
            autoFocus
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            className="vista-control mt-1 w-full px-3"
          />
        </label>
        <label className="block">
          <span className="vista-field-label">Price (RM)</span>
          <input
            inputMode="decimal"
            value={price}
            placeholder="0.00"
            onChange={(event) => setPrice(event.target.value)}
            className="vista-control mt-1 w-full px-3 tabular"
          />
        </label>
      </div>
      <label className="block">
        <span className="vista-field-label">Description (optional)</span>
        <input
          value={description}
          maxLength={200}
          onChange={(event) => setDescription(event.target.value)}
          className="vista-control mt-1 w-full px-3"
        />
      </label>
      <label className="block">
        <span className="vista-field-label">Picture link (optional)</span>
        <input
          type="url"
          value={imageUrl}
          placeholder="https://…"
          onChange={(event) => setImageUrl(event.target.value)}
          className="vista-control mt-1 w-full px-3"
        />
      </label>
      <Suggestions categoryName={category.name} suggestions={suggestions}>
        {(suggestion) => (
          <input
            type="checkbox"
            checked={copying.has(suggestion.group.id)}
            onChange={() => toggle(suggestion.group.id)}
            aria-label={`Give this item ${suggestion.group.name}`}
            className="size-5 shrink-0 accent-[var(--color-rail)]"
          />
        )}
      </Suggestions>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!canSave || busy} className="vista-button-primary min-h-11 px-4 disabled:opacity-50">
          {copying.size > 0
            ? `Add item with ${copying.size} option group${copying.size === 1 ? '' : 's'}`
            : 'Add item'}
        </button>
        <button type="button" onClick={onDone} className="vista-button-secondary min-h-11 px-4">
          Cancel
        </button>
      </div>
    </form>
  )
}

/** A price that saves when the field is left. Blank or unreadable goes back to what it was. */
function PriceField({
  priceSen,
  label,
  onSave,
}: {
  priceSen: number
  label: string
  onSave: (priceSen: number) => void
}) {
  const shown = (priceSen / 100).toFixed(2)
  const [draft, setDraft] = useState(shown)
  return (
    <span className="flex items-center border border-line bg-surface px-2">
      <span className="text-xs font-black text-muted">+RM</span>
      <input
        value={draft}
        inputMode="decimal"
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = draft.trim() === '' ? 0 : parseRinggitToSen(draft)
          if (next !== null && next >= 0 && next !== priceSen) onSave(next)
          else setDraft(shown)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        className="min-h-9 w-16 bg-transparent px-1 text-right text-sm font-bold tabular outline-none"
      />
    </span>
  )
}

/** One option: dragged by its handle; name and price edited in place. */
function OptionRow({ option, edit }: { option: ModifierGroup['options'][number]; edit: Edit }) {
  const { setNodeRef, style, handle } = useSortableRow(option.id)
  return (
    <li ref={setNodeRef} style={style} className="flex flex-wrap items-center gap-2 bg-surface py-1.5">
      <DragHandle label={`Move ${option.name}`} handle={handle} />
      <InlineName
        key={`${option.id}:${option.name}`}
        name={option.name}
        label="Option name"
        onSave={(name) => void edit({ kind: 'updateOption', id: option.id, name })}
      />
      <PriceField
        key={`${option.id}:${option.priceSen}`}
        priceSen={option.priceSen}
        label={`${option.name} extra charge`}
        onSave={(priceSen) => void edit({ kind: 'updateOption', id: option.id, priceSen })}
      />
      <button
        type="button"
        onClick={() => void edit({ kind: 'updateOption', id: option.id, isSoldOut: !option.isSoldOut })}
        className="min-h-9 border border-line px-2 text-xs font-bold text-slate-600"
      >
        {option.isSoldOut ? 'Back in stock' : 'Sold out'}
      </button>
      <IconButton
        label={`Delete ${option.name}`}
        tone="danger"
        onClick={() => void edit({ kind: 'deleteOption', id: option.id })}
      >
        <X aria-hidden="true" className="size-4" />
      </IconButton>
    </li>
  )
}

function GroupEditor({ group, edit }: { group: ModifierGroup; edit: Edit }) {
  const { setNodeRef, style, handle } = useSortableRow(group.id)
  const [optionName, setOptionName] = useState('')
  const [optionPrice, setOptionPrice] = useState('')
  const optionPriceSen = optionPrice.trim() === '' ? 0 : parseRinggitToSen(optionPrice)

  async function addOption(event: FormEvent) {
    event.preventDefault()
    if (!optionName.trim() || optionPriceSen === null) return
    const saved = await edit({
      kind: 'addOption',
      groupId: group.id,
      name: optionName.trim(),
      priceSen: optionPriceSen,
      type: optionPriceSen > 0 ? 'ADD_ON' : 'REMOVAL',
    })
    if (saved) {
      setOptionName('')
      setOptionPrice('')
    }
  }

  const optionById = new Map(group.options.map((option) => [option.id, option]))

  return (
    <div ref={setNodeRef} style={style} className="border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <DragHandle label={`Move ${group.name}`} handle={handle} />
        <InlineName
          key={`${group.id}:${group.name}`}
          name={group.name}
          label="Option group name"
          onSave={(name) => void edit({ kind: 'updateGroup', id: group.id, name })}
        />
        <label className="flex items-center gap-1 text-xs font-bold text-muted">
          Pick
          <select
            value={`${group.minSelect}-${group.maxSelect}`}
            onChange={(event) => {
              const [min, max] = event.target.value.split('-').map(Number)
              void edit({ kind: 'updateGroup', id: group.id, minSelect: min, maxSelect: max })
            }}
            className="vista-control px-2 text-sm"
          >
            <option value="1-1">exactly one (required)</option>
            <option value="0-1">up to one</option>
            <option value="0-2">up to two</option>
            <option value="0-3">up to three</option>
            <option value="0-5">up to five</option>
            {['1-1', '0-1', '0-2', '0-3', '0-5'].includes(`${group.minSelect}-${group.maxSelect}`) ? null : (
              <option value={`${group.minSelect}-${group.maxSelect}`}>
                {group.minSelect} to {group.maxSelect}
              </option>
            )}
          </select>
        </label>
        <IconButton
          label={`Delete ${group.name}`}
          tone="danger"
          onClick={() => {
            if (window.confirm(`Delete "${group.name}" and its options?`)) void edit({ kind: 'deleteGroup', id: group.id })
          }}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </IconButton>
      </div>

      <SortableList
        ids={group.options.map((option) => option.id)}
        onReorder={(ids) => edit({ kind: 'orderOptions', groupId: group.id, ids })}
      >
        {(ids) => (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {ids.map((id) => {
              const option = optionById.get(id)
              return option ? <OptionRow key={id} option={option} edit={edit} /> : null
            })}
          </ul>
        )}
      </SortableList>

      <form onSubmit={(event) => void addOption(event)} className="mt-2 flex flex-wrap gap-2">
        <input
          value={optionName}
          onChange={(event) => setOptionName(event.target.value)}
          placeholder="Option, e.g. Large"
          aria-label="Option name"
          maxLength={80}
          className="vista-control min-w-0 flex-1 px-3 text-sm"
        />
        <input
          value={optionPrice}
          onChange={(event) => setOptionPrice(event.target.value)}
          inputMode="decimal"
          placeholder="+RM 0.00"
          aria-label="Extra charge"
          className="vista-control w-28 px-3 text-sm tabular"
        />
        <button
          type="submit"
          disabled={!optionName.trim() || optionPriceSen === null}
          className="vista-button-secondary min-h-11 px-3 disabled:opacity-50"
        >
          Add option
        </button>
      </form>
    </div>
  )
}

function ProductEditor({
  product,
  products,
  categories,
  brands,
  edit,
  onClose,
}: {
  product: Product
  products: Product[]
  categories: Category[]
  brands: Brand[]
  edit: Edit
  onClose: () => void
}) {
  const [description, setDescription] = useState(product.description ?? '')
  const [imageUrl, setImageUrl] = useState(product.imageUrl)
  const [adding, setAdding] = useState<string | null>(null)
  const suggestions = useMemo(
    () => suggestGroups(products, product.categoryId, product.id, product.modifierGroups ?? []),
    [products, product.categoryId, product.id, product.modifierGroups],
  )
  const categoryName = categories.find((category) => category.id === product.categoryId)?.name ?? 'this category'

  async function addSuggested(groupId: string) {
    setAdding(groupId)
    await edit({ kind: 'copyGroup', productId: product.id, groupId })
    setAdding(null)
  }

  return (
    <div className="mt-2 w-full space-y-3 border border-line bg-canvas p-3">
      <div className="flex flex-wrap items-center gap-2">
        <InlineName
          key={`${product.id}:${product.name}`}
          name={product.name}
          label="Item name"
          onSave={(name) => void edit({ kind: 'updateProduct', id: product.id, changes: { name } })}
        />
        <CategorySelect
          value={product.categoryId}
          categories={categories}
          brands={brands}
          label="Category"
          onChange={(categoryId) =>
            void edit({ kind: 'updateProduct', id: product.id, changes: { categoryId } })
          }
        />
      </div>

      <label className="block">
        <span className="vista-field-label">Description</span>
        <input
          value={description}
          maxLength={200}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => {
            if (description.trim() !== (product.description ?? '')) {
              void edit({ kind: 'updateProduct', id: product.id, changes: { description: description.trim() } })
            }
          }}
          className="vista-control mt-1 w-full px-3"
        />
      </label>
      <label className="block">
        <span className="vista-field-label">Picture link</span>
        <input
          type="url"
          value={imageUrl}
          placeholder="https://… (leave empty for none)"
          onChange={(event) => setImageUrl(event.target.value)}
          onBlur={() => {
            const next = imageUrl.trim()
            if (next !== product.imageUrl) {
              void edit({ kind: 'updateProduct', id: product.id, changes: { imageUrl: next || null } })
            }
          }}
          className="vista-control mt-1 w-full px-3"
        />
      </label>

      <div>
        <p className="vista-field-label">Options</p>
        <div className="mt-1 space-y-2">
          <SortableList
            ids={(product.modifierGroups ?? []).map((group) => group.id)}
            onReorder={(ids) => edit({ kind: 'orderGroups', productId: product.id, ids })}
          >
            {(ids) => (
              <div className="space-y-2">
                {ids.map((id) => {
                  const group = product.modifierGroups?.find((candidate) => candidate.id === id)
                  return group ? <GroupEditor key={id} group={group} edit={edit} /> : null
                })}
              </div>
            )}
          </SortableList>
          <Suggestions categoryName={categoryName} suggestions={suggestions}>
            {(suggestion) => (
              <button
                type="button"
                disabled={adding !== null}
                onClick={() => void addSuggested(suggestion.group.id)}
                aria-label={`Add ${suggestion.group.name} to this item`}
                className="vista-button-secondary flex min-h-10 items-center gap-1 px-3 disabled:opacity-50"
              >
                <Plus aria-hidden="true" className="size-4" /> Add
              </button>
            )}
          </Suggestions>
          <AddByName
            label="Add option group"
            placeholder="Group, e.g. Size or Extras"
            onAdd={(name) => edit({ kind: 'addGroup', productId: product.id, name, minSelect: 0, maxSelect: 1 })}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => void edit({ kind: 'updateProduct', id: product.id, changes: { isActive: !product.isActive } })}
          className="vista-button-secondary min-h-11 px-4"
        >
          {product.isActive ? 'Hide from the counter' : 'Show on the counter'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Delete "${product.name}"? An item that has been sold can only be hidden.`)) {
              void edit({ kind: 'deleteProduct', id: product.id }).then((deleted) => {
                if (deleted) onClose()
              })
            }
          }}
          className="min-h-11 border border-critical/40 px-4 text-sm font-bold text-critical"
        >
          Delete item
        </button>
        <button type="button" onClick={onClose} className="vista-button-primary ml-auto min-h-11 px-4">
          Done
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * Drag ids carry what they are: `c:` a category, `p:` an item, `l:` a
 * category's list of items (so an empty category can still take a drop).
 */
const CAT = 'c:'
const ITEM = 'p:'
const LIST = 'l:'
const strip = (id: string) => id.slice(2)

/**
 * A category drag only looks at categories; an item drag only at items and
 * lists, preferring the item under the pointer over the list around it. Both
 * follow the pointer first: category panels are tall.
 */
const menuCollision: CollisionDetection = (args) => {
  const dragging = String(args.active.id)
  const containers = args.droppableContainers.filter((container) =>
    dragging.startsWith(CAT) ? String(container.id).startsWith(CAT) : !String(container.id).startsWith(CAT),
  )
  const scoped = { ...args, droppableContainers: containers }
  const hits = pointerWithin(scoped)
  if (hits.length > 0) {
    return hits.toSorted((a, b) => Number(String(b.id).startsWith(ITEM)) - Number(String(a.id).startsWith(ITEM)))
  }
  // The keyboard has no pointer.
  return closestCenter(scoped)
}

type RowProps = {
  product: Product
  store: VistaStore
  edit: Edit
  brand?: Brand
  canEdit: boolean
  isOpen: boolean
  onToggleOpen: () => void
}

function ItemRow({ product, store, edit, brand, canEdit, isOpen, onToggleOpen }: RowProps) {
  const { setNodeRef, style, handle } = useSortableRow(ITEM + product.id)
  const [editingPrice, setEditingPrice] = useState(false)
  const [draftPrice, setDraftPrice] = useState('')

  function commitPrice() {
    const sen = parseRinggitToSen(draftPrice)
    if (sen !== null && sen >= 0) store.updatePrice(product.id, sen)
    setEditingPrice(false)
  }

  return (
    <li ref={setNodeRef} style={style} className="flex flex-wrap items-center gap-3 bg-surface py-3">
      {canEdit ? <DragHandle label={`Move ${product.name}`} handle={handle} /> : null}
      <ProductThumb product={product} brand={brand} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-ink">{product.name}</p>
        <div className="flex flex-wrap gap-1">
          {product.isSoldOut ? <Badge tone="critical">Sold out</Badge> : null}
          {!product.isActive ? <Badge>Hidden</Badge> : null}
          {(product.modifierGroups?.length ?? 0) > 0 ? (
            <Badge tone="info">{product.modifierGroups?.length} option groups</Badge>
          ) : null}
        </div>
      </div>

      {editingPrice ? (
        <div className="flex items-center gap-2">
          <div className="flex items-center border-2 border-rail px-2">
            <span className="text-xs font-black text-muted">RM</span>
            <input
              autoFocus
              inputMode="decimal"
              value={draftPrice}
              onChange={(event) => setDraftPrice(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitPrice()
                if (event.key === 'Escape') setEditingPrice(false)
              }}
              className="min-h-10 w-20 bg-transparent px-1 text-right font-black tabular outline-none"
            />
          </div>
          <button type="button" onClick={commitPrice} className="vista-button-primary min-h-10">
            Save
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditingPrice(true)
            setDraftPrice((product.basePriceSen / 100).toFixed(2))
          }}
          className="min-h-10 border-b border-dotted border-muted px-2 text-base font-black tabular hover:bg-canvas"
        >
          {formatRinggit(product.basePriceSen)}
        </button>
      )}

      <button
        type="button"
        onClick={() => store.toggleSoldOut(product.id)}
        className={`min-h-10 border px-3 text-xs font-bold ${
          product.isSoldOut ? 'border-good bg-good text-white' : 'border-line bg-surface text-slate-600 hover:bg-canvas'
        }`}
      >
        {product.isSoldOut ? 'Back in stock' : 'Mark sold out'}
      </button>

      {canEdit && store.categories.length > 1 ? (
        <CategorySelect
          value={product.categoryId}
          categories={store.categories}
          brands={store.brands}
          label={`Move ${product.name} to another category`}
          onChange={(categoryId) => void edit({ kind: 'updateProduct', id: product.id, changes: { categoryId } })}
        />
      ) : null}

      {canEdit ? (
        <IconButton label={`Edit ${product.name}`} onClick={onToggleOpen}>
          <Pencil aria-hidden="true" className="size-4" />
        </IconButton>
      ) : null}

      {canEdit && isOpen ? (
        <ProductEditor
          product={product}
          products={store.products}
          categories={store.categories}
          brands={store.brands}
          edit={edit}
          onClose={onToggleOpen}
        />
      ) : null}
    </li>
  )
}

/** The list inside a category: also a drop target, so an empty category can take an item. */
function ItemList({ categoryId, children }: { categoryId: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: LIST + categoryId })
  return (
    <ul
      ref={setNodeRef}
      className={`min-h-12 divide-y divide-slate-100 ${isOver ? 'bg-canvas outline-2 outline-dashed outline-line' : ''}`}
    >
      {children}
    </ul>
  )
}

function CategoryPanel({
  category,
  itemCount,
  store,
  edit,
  brandName,
  canEdit,
  children,
}: {
  category: Category
  itemCount: number
  store: VistaStore
  edit: Edit
  brandName: string | null
  canEdit: boolean
  children: ReactNode
}) {
  const { setNodeRef, style, handle } = useSortableRow(CAT + category.id)
  return (
    <div ref={setNodeRef} style={style}>
      <Panel>
        {canEdit ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {store.categories.length > 1 ? (
              <DragHandle label={`Move the ${category.name} category`} handle={handle} />
            ) : null}
            <InlineName
              key={`${category.id}:${category.name}`}
              name={category.name}
              label="Category name"
              onSave={(name) => void edit({ kind: 'renameCategory', id: category.id, name })}
            />
            {brandName ? <Badge>{brandName}</Badge> : null}
            {itemCount === 0 ? (
              <IconButton
                label={`Delete ${category.name}`}
                tone="danger"
                onClick={() => void edit({ kind: 'deleteCategory', id: category.id })}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </IconButton>
            ) : null}
          </div>
        ) : (
          <SectionHeading title={category.name} />
        )}
        {children}
      </Panel>
    </div>
  )
}

export function MenuScreen({ store }: { store: VistaStore }) {
  const [brandFilter, setBrandFilter] = useState<string | null>(null)
  const [openProduct, setOpenProduct] = useState<string | null>(null)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const canEdit = store.canEditMenu
  const edit = store.editMenu
  const sensors = useDragSensors()

  const brandById = useMemo(() => new Map(store.brands.map((brand) => [brand.id, brand])), [store.brands])
  const productById = useMemo(() => new Map(store.products.map((product) => [product.id, product])), [store.products])

  // The server's arrangement, and — while a drag is under way or a new order is
  // on its way to the server — the arrangement on screen. The override is
  // dropped by itself once the server's arrangement changes.
  const serverCategoryOrder = useMemo(() => store.categories.map((category) => category.id), [store.categories])
  const serverLayout = useMemo(() => layoutOf(serverCategoryOrder, store.products), [serverCategoryOrder, store.products])
  const serverKey = JSON.stringify([serverCategoryOrder, serverLayout])
  const [override, setOverride] = useState<{ base: string; categoryOrder: string[]; layout: Layout } | null>(null)
  const current = override && override.base === serverKey ? override : null
  const categoryOrder = current?.categoryOrder ?? serverCategoryOrder
  const layout = current?.layout ?? serverLayout
  const categoryById = useMemo(() => new Map(store.categories.map((category) => [category.id, category])), [store.categories])

  const shownCategories = categoryOrder
    .map((id) => categoryById.get(id))
    .filter((category): category is Category => category !== undefined)
    .filter((category) => brandFilter === null || category.brandId === brandFilter)
    // An empty category is only worth showing to someone who can fill it.
    .filter((category) => canEdit || (layout[category.id]?.length ?? 0) > 0)

  function arrange(next: { categoryOrder?: string[]; layout?: Layout }) {
    setOverride({
      base: serverKey,
      categoryOrder: next.categoryOrder ?? categoryOrder,
      layout: next.layout ?? layout,
    })
  }

  /** Save, and if the server refuses, show its arrangement again. */
  function save(change: MenuEdit) {
    void edit(change).then((saved) => {
      if (!saved) setOverride(null)
    })
  }

  // An item dragged over another category moves into it straight away, so the
  // owner sees where it will land.
  function onDragOver({ active, over }: DragOverEvent) {
    const dragging = String(active.id)
    if (!over || !dragging.startsWith(ITEM)) return
    const itemId = strip(dragging)
    const overId = String(over.id)
    const target = overId.startsWith(LIST) ? strip(overId) : overId.startsWith(ITEM) ? categoryOf(layout, strip(overId)) : null
    const from = categoryOf(layout, itemId)
    if (!target || !from || target === from) return
    arrange({ layout: moveItem(layout, itemId, target, overId.startsWith(ITEM) ? strip(overId) : null) })
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const dragging = String(active.id)
    const overId = over ? String(over.id) : null

    if (dragging.startsWith(CAT)) {
      if (!overId || !overId.startsWith(CAT) || overId === dragging) return
      const shown = shownCategories.map((category) => category.id)
      const moved = arrayMove(shown, shown.indexOf(strip(dragging)), shown.indexOf(strip(overId)))
      const full = reorderWithin(categoryOrder, moved)
      arrange({ categoryOrder: full })
      save({ kind: 'orderCategories', ids: full })
      return
    }

    const itemId = strip(dragging)
    const category = categoryOf(layout, itemId)
    if (!category) return
    let next = layout
    if (overId?.startsWith(ITEM) && overId !== dragging && categoryOf(layout, strip(overId)) === category) {
      const list = layout[category]!
      next = { ...layout, [category]: arrayMove(list, list.indexOf(itemId), list.indexOf(strip(overId))) }
      arrange({ layout: next })
    }
    // Only this category's list needs saving: an item that left another one
    // takes nothing from the order of what stayed behind.
    if (JSON.stringify(next[category]) !== JSON.stringify(serverLayout[category])) {
      save({ kind: 'orderProducts', categoryId: category, ids: next[category]! })
    }
  }

  const isEmpty = store.products.length === 0

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-b border-line pb-5">
        <p className="page-kicker">Catalogue / live availability</p>
        <h1 className="mt-1 text-3xl sm:text-[2.65rem]">Menu</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Prices here are what the register charges. Changing one never alters a sale already made —
          past orders keep the price they were rung up at.
          {canEdit ? ' Drag the handles to change the order the counter shows, or to move an item to another category.' : ''}
        </p>
      </div>

      {canEdit && isEmpty ? (
        <Panel className="border-l-4 border-l-food">
          <p className="font-black">Add your first item</p>
          <p className="mt-1 text-sm text-muted">
            Your menu is empty, so the counter has nothing to sell yet. Use &ldquo;Add item&rdquo; under a
            category below. Rename the brand and category first if you like.
          </p>
        </Panel>
      ) : null}

      {canEdit ? <BrandsPanel store={store} edit={edit} /> : null}

      {store.brands.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setBrandFilter(null)}
            className={`min-h-11 border px-4 text-sm font-bold ${
              brandFilter === null ? 'border-rail bg-rail text-white' : 'border-line bg-surface text-slate-700'
            }`}
          >
            All
          </button>
          {store.brands.map((brand) => (
            <button
              key={brand.id}
              type="button"
              onClick={() => setBrandFilter(brand.id)}
              style={brandFilter === brand.id ? { backgroundColor: brand.colour } : undefined}
              className={`min-h-11 border px-4 text-sm font-bold ${
                brandFilter === brand.id ? 'border-transparent text-white' : 'border-line bg-surface text-slate-700'
              }`}
            >
              {brand.name}
            </button>
          ))}
        </div>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={menuCollision}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setOverride(null)}
      >
        <SortableContext items={shownCategories.map((category) => CAT + category.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-6">
            {shownCategories.map((category) => {
              const itemIds = layout[category.id] ?? []
              return (
                <CategoryPanel
                  key={category.id}
                  category={category}
                  itemCount={itemIds.length}
                  store={store}
                  edit={edit}
                  brandName={store.brands.length > 1 ? (brandById.get(category.brandId)?.name ?? '—') : null}
                  canEdit={canEdit}
                >
                  <SortableContext items={itemIds.map((id) => ITEM + id)} strategy={verticalListSortingStrategy}>
                    <ItemList categoryId={category.id}>
                      {itemIds.map((id) => {
                        const product = productById.get(id)
                        if (!product) return null
                        return (
                          <ItemRow
                            key={id}
                            product={product}
                            store={store}
                            edit={edit}
                            brand={brandById.get(product.brandId)}
                            canEdit={canEdit}
                            isOpen={openProduct === id}
                            onToggleOpen={() => setOpenProduct(openProduct === id ? null : id)}
                          />
                        )
                      })}
                      {canEdit && itemIds.length === 0 ? (
                        <li className="py-3 text-sm text-muted">No items yet. Add one, or drag one here.</li>
                      ) : null}
                    </ItemList>
                  </SortableContext>

                  {canEdit ? (
                    addingTo === category.id ? (
                      <NewProductForm
                        category={category}
                        products={store.products}
                        edit={edit}
                        onDone={() => setAddingTo(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingTo(category.id)}
                        className="mt-2 flex min-h-11 items-center gap-1 px-1 text-sm font-bold text-ink underline"
                      >
                        <Plus aria-hidden="true" className="size-4" /> Add item
                      </button>
                    )
                  ) : null}
                </CategoryPanel>
              )
            })}
          </div>
        </SortableContext>
      </DndContext>

      {canEdit ? (
        <Panel>
          <SectionHeading title="Add a category" hint="Groups items on the counter, like Rice or Cold drinks." />
          {store.brands.map((brand) => (
            <div key={brand.id} className="mt-2">
              {store.brands.length > 1 ? <p className="mb-1 text-xs font-bold text-muted">{brand.name}</p> : null}
              <AddByName
                label="Add category"
                placeholder="Category name"
                onAdd={(name) => edit({ kind: 'addCategory', brandId: brand.id, name })}
              />
            </div>
          ))}
        </Panel>
      ) : null}
    </div>
  )
}
