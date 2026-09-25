import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Badge, Panel, SectionHeading } from '../components/primitives.tsx'
import type { MenuEdit, VistaStore } from '../data/store.ts'
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
  edit,
  onDone,
}: {
  category: Category
  edit: Edit
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [busy, setBusy] = useState(false)
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
    })
    setBusy(false)
    if (saved) onDone()
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
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!canSave || busy} className="vista-button-primary min-h-11 px-4 disabled:opacity-50">
          Add item
        </button>
        <button type="button" onClick={onDone} className="vista-button-secondary min-h-11 px-4">
          Cancel
        </button>
      </div>
    </form>
  )
}

function GroupEditor({ group, edit }: { group: ModifierGroup; edit: Edit }) {
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

  return (
    <div className="border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
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

      <ul className="mt-2 divide-y divide-slate-100 text-sm">
        {group.options.map((option) => (
          <li key={option.id} className="flex items-center gap-2 py-1.5">
            <span className="flex-1 font-bold">{option.name}</span>
            <span className="tabular text-muted">
              {option.priceSen > 0 ? `+${formatRinggit(option.priceSen)}` : 'free'}
            </span>
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
        ))}
      </ul>

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
  categories,
  edit,
  onClose,
}: {
  product: Product
  categories: Category[]
  edit: Edit
  onClose: () => void
}) {
  const [description, setDescription] = useState(product.description ?? '')
  const [imageUrl, setImageUrl] = useState(product.imageUrl)

  return (
    <div className="mt-2 w-full space-y-3 border border-line bg-canvas p-3">
      <div className="flex flex-wrap items-center gap-2">
        <InlineName
          key={`${product.id}:${product.name}`}
          name={product.name}
          label="Item name"
          onSave={(name) => void edit({ kind: 'updateProduct', id: product.id, changes: { name } })}
        />
        <select
          value={product.categoryId}
          aria-label="Category"
          onChange={(event) =>
            void edit({ kind: 'updateProduct', id: product.id, changes: { categoryId: event.target.value } })
          }
          className="vista-control px-2 text-sm"
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
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
          {(product.modifierGroups ?? []).map((group) => (
            <GroupEditor key={group.id} group={group} edit={edit} />
          ))}
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

export function MenuScreen({ store }: { store: VistaStore }) {
  const [brandFilter, setBrandFilter] = useState<string | null>(null)
  const [editingPrice, setEditingPrice] = useState<string | null>(null)
  const [draftPrice, setDraftPrice] = useState('')
  const [openProduct, setOpenProduct] = useState<string | null>(null)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const canEdit = store.canEditMenu
  const edit = store.editMenu

  const brandById = useMemo(() => new Map(store.brands.map((brand) => [brand.id, brand])), [store.brands])

  const grouped = useMemo(() => {
    const visible = store.products.filter(
      (product) => brandFilter === null || product.brandId === brandFilter,
    )
    return store.categories
      .filter((category) => brandFilter === null || category.brandId === brandFilter)
      .map((category) => ({
        category,
        products: visible.filter((product) => product.categoryId === category.id),
      }))
      // An empty category is only worth showing to someone who can fill it.
      .filter((group) => canEdit || group.products.length > 0)
  }, [store.products, store.categories, brandFilter, canEdit])

  function commitPrice(productId: string) {
    const sen = parseRinggitToSen(draftPrice)
    if (sen !== null && sen >= 0) store.updatePrice(productId, sen)
    setEditingPrice(null)
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

      {grouped.map(({ category, products }) => (
        <Panel key={category.id}>
          {canEdit ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <InlineName
                key={`${category.id}:${category.name}`}
                name={category.name}
                label="Category name"
                onSave={(name) => void edit({ kind: 'renameCategory', id: category.id, name })}
              />
              {store.brands.length > 1 ? (
                <Badge>{brandById.get(category.brandId)?.name ?? '—'}</Badge>
              ) : null}
              {products.length === 0 ? (
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

          <ul className="divide-y divide-slate-100">
            {products.map((product) => (
              <li key={product.id} className="flex flex-wrap items-center gap-3 py-3">
                <ProductThumb product={product} brand={brandById.get(product.brandId)} />
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

                {editingPrice === product.id ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center border-2 border-rail px-2">
                      <span className="text-xs font-black text-muted">RM</span>
                      <input
                        autoFocus
                        inputMode="decimal"
                        value={draftPrice}
                        onChange={(event) => setDraftPrice(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitPrice(product.id)
                          if (event.key === 'Escape') setEditingPrice(null)
                        }}
                        className="min-h-10 w-20 bg-transparent px-1 text-right font-black tabular outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => commitPrice(product.id)}
                      className="vista-button-primary min-h-10"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingPrice(product.id)
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
                    product.isSoldOut
                      ? 'border-good bg-good text-white'
                      : 'border-line bg-surface text-slate-600 hover:bg-canvas'
                  }`}
                >
                  {product.isSoldOut ? 'Back in stock' : 'Mark sold out'}
                </button>

                {canEdit ? (
                  <IconButton
                    label={`Edit ${product.name}`}
                    onClick={() => setOpenProduct(openProduct === product.id ? null : product.id)}
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </IconButton>
                ) : null}

                {canEdit && openProduct === product.id ? (
                  <ProductEditor
                    product={product}
                    categories={store.categories}
                    edit={edit}
                    onClose={() => setOpenProduct(null)}
                  />
                ) : null}
              </li>
            ))}
          </ul>

          {canEdit ? (
            addingTo === category.id ? (
              <NewProductForm category={category} edit={edit} onDone={() => setAddingTo(null)} />
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
        </Panel>
      ))}

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
