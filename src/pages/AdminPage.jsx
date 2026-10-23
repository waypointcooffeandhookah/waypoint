import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogOut, Plus, Pencil, Trash2, X, Check, LayoutGrid, UtensilsCrossed, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../supabaseClient'
import { getItemImage, getItemDescription } from '../utils/imageUtils'
import './AdminPage.css'
import { PromotionSettings } from './Promotion'
import ImageUpload from './ImageUpload'
import SocialSettings from './SocialSettings'

/* ================================================================
   ADMIN PAGE — Waypoint QR Menu
   © 2024 Mehmet Ali ERDOĞAN
   ================================================================ */

export default function AdminPage() {
  const navigate    = useNavigate()
  const [tab, setTab]           = useState('items')   // 'items' | 'categories'
  const [categories, setCategories] = useState([])
  const [items, setItems]           = useState([])
  const [loading, setLoading]       = useState(true)

  // ── Modals ──
  const [catModal, setCatModal]   = useState(null)    // null | {} | {id, ...}
  const [itemModal, setItemModal] = useState(null)    // null | {} | {id, ...}

  const reload = async () => {
    setLoading(true)
    const [{ data: cats }, { data: its }] = await Promise.all([
      supabase.from('categories').select('*').order('sort_order'),
      supabase.from('menu_items').select('*, categories(name)').order('created_at'),
    ])
    const mappedItems = (its || []).map(it => ({
      ...it,
      image_url: it.image_url || getItemImage(it) || null,
      description: it.description || getItemDescription(it) || null,
    }))
    setCategories(cats || [])
    setItems(mappedItems)
    setLoading(false)
  }

  useEffect(() => { reload() }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    toast.success('Çıkış yapıldı.')
    navigate('/admin/login')
  }

  const availCount = items.filter(i => i.is_available !== false).length

  return (
    <div className="admin-layout">
      {/* ── Header ── */}
      <header className="admin-header">
        <div className="admin-header-brand">
          <img
            src={`${import.meta.env.BASE_URL}logo-balanced.png`}
            alt="Waypoint Logo"
            className="admin-header-logo-img"
          />
          <div>
            <div className="admin-header-logo">WAYPOINT</div>
            <div className="admin-header-sub">COFFEE & HOOKAH • YÖNETİCİ</div>
          </div>
        </div>
        <div className="admin-header-actions">
          <Link to="/" className="btn btn-ghost btn-sm">
            <Eye size={14} /> Menüyü Gör
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
            <LogOut size={14} /> Çıkış
          </button>
        </div>
      </header>

      {/* ── Content ── */}
      <div className="admin-content">
        {/* Stats */}
        <div className="stats-grid fade-up">
          <div className="stat-card">
            <div className="stat-value">{categories.length}</div>
            <div className="stat-label">Kategori</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{items.length}</div>
            <div className="stat-label">Toplam Ürün</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{availCount}</div>
            <div className="stat-label">Mevcut</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="admin-tabs fade-up-2">
          <button className={`admin-tab${tab === 'social' ? ' active' : ''}`} onClick={() => setTab('social')}>Sosyal Medya</button>
          <button className={`admin-tab${tab === 'promotion' ? ' active' : ''}`} onClick={() => setTab('promotion')}><Eye size={15} /> Karşılama Reklamı</button>
          <button
            className={`admin-tab${tab === 'items' ? ' active' : ''}`}
            onClick={() => setTab('items')}
          >
            <UtensilsCrossed size={15} /> Ürünler
          </button>
          <button
            className={`admin-tab${tab === 'categories' ? ' active' : ''}`}
            onClick={() => setTab('categories')}
          >
            <LayoutGrid size={15} /> Kategoriler
          </button>
        </div>

        {loading ? (
          <div className="loading-screen">
            <div className="spinner" />
          </div>
        ) : tab === 'social' ? <SocialSettings /> : tab === 'promotion' ? <PromotionSettings items={items} /> : tab === 'items' ? (
          <ItemsSection
            items={items}
            categories={categories}
            onAdd={() => setItemModal({})}
            onEdit={item => setItemModal(item)}
            onDelete={async item => {
              if (!confirm(`"${item.name}" silinsin mi?`)) return
              const { error } = await supabase.from('menu_items').delete().eq('id', item.id)
              if (error) return toast.error('Ürün silinemedi. Yetkinizi ve bağlantınızı kontrol edin.')
              toast.success('Ürün silindi.')
              reload()
            }}
            onToggle={async item => {
              const { error } = await supabase.from('menu_items')
                .update({ is_available: !item.is_available })
                .eq('id', item.id)
              if (error) return toast.error('Stok durumu değiştirilemedi. Yetkinizi ve bağlantınızı kontrol edin.')
              reload()
            }}
          />
        ) : (
          <CategoriesSection
            categories={categories}
            onAdd={() => setCatModal({})}
            onEdit={cat => setCatModal(cat)}
            onDelete={async cat => {
              if (!confirm(`"${cat.name}" kategorisi silinsin mi? İçindeki ürünler de etkilenebilir.`)) return
              const { error } = await supabase.from('categories').delete().eq('id', cat.id)
              if (error) return toast.error('Kategori silinemedi. Yetkinizi ve bağlantınızı kontrol edin.')
              toast.success('Kategori silindi.')
              reload()
            }}
          />
        )}
      </div>

      {/* ── Modals ── */}
      {catModal  && <CategoryModal  data={catModal}  onClose={() => setCatModal(null)}  onSaved={reload} />}
      {itemModal && <ItemModal      data={itemModal}  onClose={() => setItemModal(null)} onSaved={reload} categories={categories} />}

      {/* ── Footer ── */}
      <footer className="admin-footer">
        © <span>Mehmet Ali ERDOĞAN</span>
      </footer>
    </div>
  )
}

/* ================================================================
   ITEMS SECTION
   ================================================================ */
function ItemsSection({ items, categories, onAdd, onEdit, onDelete, onToggle }) {
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR')
  const visibleItems = items.filter(item => (!categoryId || item.category_id === categoryId) &&
    (!normalizedQuery || `${item.name} ${item.description || ''}`.toLocaleLowerCase('tr-TR').includes(normalizedQuery)))
  const clearFilters = () => { setQuery(''); setCategoryId('') }
  return (
    <>
      <div className="section-header fade-up-3">
        <h2 className="section-title">Ürünler ({visibleItems.length}{visibleItems.length !== items.length ? ` / ${items.length}` : ''})</h2>
        <button className="btn btn-primary btn-sm" onClick={onAdd}>
          <Plus size={15} /> Ürün Ekle
        </button>
      </div>

      <div className="admin-product-filters">
        <label className="input-group" htmlFor="admin-product-category">
          <span className="input-label">Kategori</span>
          <select id="admin-product-category" className="input" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">Tüm kategoriler</option>
            {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="input-group" htmlFor="admin-product-search">
          <span className="input-label">Ürün ara</span>
          <input id="admin-product-search" className="input" type="search" placeholder="Ürün adı veya açıklaması…" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        {(query || categoryId) && <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>Temizle</button>}
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <UtensilsCrossed size={48} />
          <h3>Henüz ürün yok</h3>
          <p>İlk ürününüzü eklemek için butona tıklayın.</p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="empty-state" role="status"><h3>Ürün bulunamadı</h3><p>Başka bir kelime veya kategori deneyin.</p><button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>Filtreleri temizle</button></div>
      ) : (
        <div className="data-list">
          {visibleItems.map(item => (
            <div className="data-row fade-in" key={item.id}>
              <div className="data-row-img">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.name} />
                ) : (
                  <UtensilsCrossed size={16} strokeWidth={1.5} color="var(--text-muted)" />
                )}
              </div>
              <div className="data-row-info">
                <div className="data-row-name">{item.name}</div>
                <div className="data-row-meta">
                  {item.categories?.name}
                  {' · '}
                  <span className={`badge ${item.is_available !== false ? 'badge-available' : 'badge-unavailable'}`}
                    style={{ fontSize: '0.7rem', padding: '2px 8px' }}>
                    {item.is_available !== false ? 'Mevcut' : 'Tükendi'}
                  </span>
                </div>
              </div>
              <div className="data-row-price">
                {item.price != null && item.price > 0
                  ? Number(item.price).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })
                  : '—'}
              </div>
              <div className="data-row-actions">
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  title={item.is_available !== false ? 'Tükendi işaretle' : 'Mevcut işaretle'}
                  onClick={() => onToggle(item)}
                >
                  {item.is_available !== false ? <Check size={13} color="#4ade80" /> : <X size={13} color="#f87171" />}
                </button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onEdit(item)}>
                  <Pencil size={13} />
                </button>
                <button className="btn btn-danger btn-icon btn-sm" onClick={() => onDelete(item)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/* ================================================================
   CATEGORIES SECTION
   ================================================================ */
function CategoriesSection({ categories, onAdd, onEdit, onDelete }) {
  return (
    <>
      <div className="section-header fade-up-3">
        <h2 className="section-title">Kategoriler ({categories.length})</h2>
        <button className="btn btn-primary btn-sm" onClick={onAdd}>
          <Plus size={15} /> Kategori Ekle
        </button>
      </div>

      {categories.length === 0 ? (
        <div className="empty-state">
          <LayoutGrid size={48} />
          <h3>Henüz kategori yok</h3>
          <p>Ürün eklemek için önce kategori oluşturun.</p>
        </div>
      ) : (
        <div className="data-list">
          {categories.map(cat => (
            <div className="data-row fade-in" key={cat.id}>
              <div className="data-row-img">
                {cat.image_url ? (
                  <img src={cat.image_url} alt={cat.name} />
                ) : (
                  <LayoutGrid size={16} strokeWidth={1.5} color="var(--text-muted)" />
                )}
              </div>
              <div className="data-row-info">
                <div className="data-row-name">{cat.name}</div>
                <div className="data-row-meta">Sıra: {cat.sort_order ?? 0}</div>
              </div>
              <div className="data-row-actions">
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onEdit(cat)}>
                  <Pencil size={13} />
                </button>
                <button className="btn btn-danger btn-icon btn-sm" onClick={() => onDelete(cat)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/* ================================================================
   CATEGORY MODAL
   ================================================================ */
function CategoryModal({ data, onClose, onSaved }) {
  const isEdit = !!data.id
  const [form, setForm] = useState({
    name: data.name || '',
    image_url: data.image_url || '',
    sort_order: Math.max(1, data.sort_order ?? 1),
  })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async (e) => {
    e.preventDefault()
    if (uploading) return
    if (!form.name.trim()) return toast.error('Kategori adı gerekli.')
    setSaving(true)
    const position = Number(form.sort_order)
    if (!Number.isInteger(position) || position < 1) { setSaving(false); return toast.error('Sıra 1 veya daha büyük bir tam sayı olmalı.') }
    const { error } = await supabase.rpc('save_category_order', {
      p_id: data.id || null,
      p_name: form.name.trim(),
      p_image_url: form.image_url.trim() || null,
      p_position: position,
    })
    setSaving(false)
    if (error) { toast.error(error.code === 'PGRST202' ? 'Sıralama kurulumu gerekli: supabase_category_order.sql dosyasını çalıştırın.' : 'Hata: ' + error.message); return }
    toast.success(isEdit ? 'Kategori güncellendi.' : 'Kategori eklendi.')
    onSaved(); onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Kategori Düzenle' : 'Yeni Kategori'}</span>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={16} /></button>
        </div>
        <form className="modal-form" onSubmit={save}>
          <div className="input-group">
            <label className="input-label">Kategori Adı *</label>
            <input className="input" placeholder="Örn: Başlangıçlar" value={form.name}
              onChange={e => set('name', e.target.value)} required />
          </div>
          <div className="input-group">
            <ImageUpload value={form.image_url} onChange={url => set('image_url', url)} onBusy={setUploading} />
            <label className="input-label">Görsel URL (isteğe bağlı)</label>
            <input className="input" placeholder="https://..." value={form.image_url}
              onChange={e => set('image_url', e.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-label">Sıralama</label>
            <input className="input" type="number" min={1} step={1} value={form.sort_order}
              onChange={e => set('sort_order', e.target.value)} />
            <small>Diğer kategorilerin sırası otomatik kaydırılır. Büyük bir sayı girerseniz kategori sona taşınır.</small>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>İptal</button>
            <button type="submit" className="btn btn-primary" disabled={saving || uploading}>
              {saving ? 'Kaydediliyor…' : isEdit ? 'Güncelle' : 'Ekle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ================================================================
   ITEM MODAL
   ================================================================ */
function ItemModal({ data, onClose, onSaved, categories }) {
  const isEdit = !!data.id
  const [form, setForm] = useState({
    name: data.name || '',
    description: data.description || '',
    price: data.price || '',
    image_url: data.image_url || '',
    category_id: data.category_id || (categories[0]?.id ?? ''),
    is_available: data.is_available !== false,
  })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async (e) => {
    e.preventDefault()
    if (uploading) return
    if (!form.name.trim()) return toast.error('Ürün adı gerekli.')
    if (!form.price)        return toast.error('Fiyat gerekli.')
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      price: Number(form.price),
      image_url: form.image_url.trim() || null,
      category_id: form.category_id || null,
      is_available: form.is_available,
    }
    const { error } = isEdit
      ? await supabase.from('menu_items').update(payload).eq('id', data.id)
      : await supabase.from('menu_items').insert(payload)
    setSaving(false)
    if (error) { toast.error('Hata: ' + error.message); return }
    toast.success(isEdit ? 'Ürün güncellendi.' : 'Ürün eklendi.')
    onSaved(); onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Ürün Düzenle' : 'Yeni Ürün'}</span>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={16} /></button>
        </div>
        <form className="modal-form" onSubmit={save}>
          <div className="input-group">
            <label className="input-label">Ürün Adı *</label>
            <input className="input" placeholder="Örn: Izgara Köfte" value={form.name}
              onChange={e => set('name', e.target.value)} required />
          </div>

          <div className="input-group">
            <label className="input-label">Açıklama</label>
            <textarea className="input" placeholder="İçerik ve hazırlanış bilgisi…" value={form.description}
              onChange={e => set('description', e.target.value)} rows={3} />
          </div>

          <div className="admin-form-columns">
            <div className="input-group">
              <label className="input-label">Fiyat (₺) *</label>
              <input className="input" type="number" min={0} step="0.01" placeholder="0.00"
                value={form.price} onChange={e => set('price', e.target.value)} required />
            </div>
            <div className="input-group">
              <label className="input-label">Kategori</label>
              <select className="input" value={form.category_id}
                onChange={e => set('category_id', e.target.value)}>
                <option value="">— Seçiniz —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="input-group">
            <ImageUpload value={form.image_url} onChange={url => set('image_url', url)} onBusy={setUploading} />
            <label className="input-label">Görsel URL</label>
            <input className="input" placeholder="https://..." value={form.image_url}
              onChange={e => set('image_url', e.target.value)} />
          </div>

          <div className="toggle-wrap">
            <span className="toggle-label">Ürün mevcut / stokta var</span>
            <label className="toggle">
              <input type="checkbox" checked={form.is_available}
                onChange={e => set('is_available', e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>İptal</button>
            <button type="submit" className="btn btn-primary" disabled={saving || uploading}>
              {saving ? 'Kaydediliyor…' : isEdit ? 'Güncelle' : 'Ekle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
