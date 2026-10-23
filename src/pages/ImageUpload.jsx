import { useState } from 'react'
import toast from 'react-hot-toast'
import { uploadMenuImage } from '../utils/storageImages'

export default function ImageUpload({ value, onChange, onBusy }) {
  const [busy, setBusy] = useState(false)
  async function upload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true); onBusy(true)
    try {
      onChange(await uploadMenuImage(file))
      toast.success('Görsel yüklendi. Ürüne bağlamak için kaydedin.')
    } catch (error) { toast.error(error.message) }
    finally { setBusy(false); onBusy(false); event.target.value = '' }
  }
  return <div className="input-group">
    <label className="input-label">Fotoğraf yükle (JPG, PNG, WebP · en fazla 5 MB)
      <input className="input" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={upload} />
    </label>
    {busy && <span role="status">Fotoğraf yükleniyor…</span>}
    {value && <img src={value} alt="Seçilen görsel önizlemesi" style={{ width: 120, height: 100, objectFit: 'contain', background: '#fff', borderRadius: 12 }} />}
  </div>
}
