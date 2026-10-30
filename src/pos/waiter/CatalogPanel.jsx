import { memo, useDeferredValue, useMemo, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { filterCatalog } from '../catalog'
import { formatCents } from '../money'

const ProductRow = memo(function ProductRow({ item, quantity, disabled, onAdd }) {
  return (
    <li>
      <button type="button" className={`wt-product${item.available ? '' : ' out'}`} disabled={disabled || !item.available}
        onClick={() => onAdd(item)} aria-label={`${item.name} ekle, ${formatCents(item.priceCents)}`}>
        <span className="wt-product-img">
          {item.image ? <img src={item.image} alt="" loading="lazy" decoding="async" /> : <span aria-hidden="true">{item.name.charAt(0)}</span>}
        </span>
        <span className="wt-product-body">
          <span className="wt-product-eyebrow">{item.categoryName}</span>
          <span className="wt-product-name">{item.name}</span>
          <span className="wt-product-price">{item.available ? formatCents(item.priceCents) : 'Tükendi'}</span>
        </span>
        <span className={`wt-product-add${quantity ? ' has-qty' : ''}`} aria-hidden="true">
          {quantity ? quantity : <Plus size={18} />}
        </span>
      </button>
    </li>
  )
})

export default function CatalogPanel({ catalog, quantities, locked, onAdd }) {
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState(catalog.categories[0]?.id ?? null)
  const deferredQuery = useDeferredValue(query)
  const items = useMemo(() => filterCatalog(catalog.items, { query: deferredQuery, categoryId }), [catalog.items, deferredQuery, categoryId])
  const searching = deferredQuery.trim().length > 0

  return (
    <section className="wt-catalog" aria-label="Ürün kataloğu">
      <div className="wt-catalog-tools">
        <div className="menu-search-wrap">
          <Search size={16} className="menu-search-icon" aria-hidden="true" />
          <input className="menu-search wt-search" type="search" placeholder="Ürün ara…" value={query}
            onChange={e => setQuery(e.target.value)} aria-label="Ürün ara" enterKeyHint="search" />
          {query && <button type="button" className="menu-search-clear" onClick={() => setQuery('')} aria-label="Aramayı temizle"><X size={16} /></button>}
        </div>
        <div className={`pos-chips pos-chips-scroll${searching ? ' dimmed' : ''}`} role="tablist" aria-label="Kategoriler">
          {catalog.categories.map(cat => (
            <button key={cat.id} type="button" role="tab" aria-selected={!searching && categoryId === cat.id}
              className={`pos-chip${!searching && categoryId === cat.id ? ' active' : ''}`}
              onClick={() => { setCategoryId(cat.id); setQuery('') }}>{cat.name}</button>
          ))}
        </div>
      </div>

      {searching && <p className="pos-muted wt-result-count">{items.length} ürün bulundu</p>}
      <ul className="wt-product-list">
        {items.map(item => (
          <ProductRow key={item.id} item={item} quantity={quantities.get(item.id) ?? 0} disabled={locked} onAdd={onAdd} />
        ))}
      </ul>
      {items.length === 0 && <div className="empty-state"><h3>Ürün bulunamadı</h3><p>Farklı bir kelimeyle arayın.</p></div>}
    </section>
  )
}
