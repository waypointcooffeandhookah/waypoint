import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../supabaseClient'
import { getItemImage } from '../utils/imageUtils'
import { useDialog } from '../utils/useDialog'
import './Promotion.css'

export function PromotionSettings({ items }) {
  const [productId, setProductId] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    supabase.from('menu_promotion').select('*').eq('id', 1).maybeSingle().then(({ data, error }) => {
      if (!active) return
      if (error) setError('Reklam ayarları yüklenemedi. Bağlantıyı ve supabase_promotion.sql kurulumunu kontrol edin.')
      else { setProductId(data?.product_id || ''); setEnabled(data?.enabled || false); setReady(true) }
    })
    return () => { active = false }
  }, [])
  const product = items.find(item => item.id === productId)
  async function save(event) {
    event.preventDefault()
    if (enabled && (!product || product.is_available === false)) return toast.error('Mevcut bir ürün seçin.')
    setSaving(true)
    const { error } = await supabase.from('menu_promotion').upsert({ id: 1, product_id: productId || null, enabled })
    setSaving(false)
    if (error) return toast.error('Reklam kaydedilemedi. Yetkinizi ve bağlantınızı kontrol edin.')
    toast.success('Karşılama reklamı kaydedildi.')
  }
  return <form className="promotion-settings" onSubmit={save}>
    <h2>Karşılama reklamı</h2>
    <p>Seçilen ürün, ziyaretçi “Menüyü keşfet” düğmesiyle veya kaydırarak menüye geçtiğinde bir kez gösterilir.</p>
    {error && <p role="alert">{error}</p>}
    <label><input type="checkbox" checked={enabled} disabled={!ready || saving} onChange={e => setEnabled(e.target.checked)} /> Reklamı etkinleştir</label>
    <label htmlFor="promotion-product">Gösterilecek ürün</label>
    <select id="promotion-product" className="input" value={productId} disabled={!ready || saving} onChange={e => setProductId(e.target.value)}>
      <option value="">Ürün seçin</option>
      {items.map(item => <option key={item.id} value={item.id}>{item.name}{item.is_available === false ? ' (Tükendi)' : ''}</option>)}
    </select>
    {product && <div className="promotion-preview">{getItemImage(product) && <img src={getItemImage(product)} alt={product.name} />}<strong>{product.name}</strong></div>}
    <button className="btn btn-primary" disabled={!ready || saving}>{saving ? 'Kaydediliyor…' : 'Kaydet'}</button>
  </form>
}

export function WelcomePromotion({ product, onClose, onOpen }) {
  const close = onClose
  const dialogRef = useDialog(close)
  const image = getItemImage(product)
  return <div className="welcome-promotion-backdrop" onClick={close}>
    <section className="welcome-promotion" role="dialog" aria-modal="true" aria-labelledby="promotion-title" ref={dialogRef} tabIndex={-1} onClick={e => e.stopPropagation()}>
      <button type="button" className="promotion-close" aria-label="Reklamı kapat" onClick={close}><X size={22} /></button>
      {image && <img className="promotion-image" src={image} alt={product.name} />}
      <div className="promotion-copy"><span>ÖNE ÇIKAN LEZZET</span><h2 id="promotion-title">{product.name}</h2>
        {product.description && <p>{product.description}</p>}
        <button className="btn btn-primary" onClick={() => onOpen(product)}>Ürüne git</button>
      </div>
    </section>
  </div>
}
