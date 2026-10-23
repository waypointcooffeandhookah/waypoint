import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../supabaseClient'
import { INSTAGRAM_URL, normalizeInstagram, normalizeWhatsApp } from '../socialLinks'

export default function SocialSettings() {
  const [instagram, setInstagram] = useState(INSTAGRAM_URL)
  const [whatsapp, setWhatsapp] = useState('905550109134')
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    supabase.from('social_settings').select('*').eq('id', 1).maybeSingle().then(({ data, error }) => {
      if (!active) return
      if (error) setError('Ayarlar yüklenemedi. Bağlantıyı ve supabase_social.sql kurulumunu kontrol edin.')
      else { if (data) { setInstagram(data.instagram_url); setWhatsapp(data.whatsapp_number) } setReady(true) }
    })
    return () => { active = false }
  }, [])
  async function save(event) {
    event.preventDefault()
    try {
      const instagramUrl = normalizeInstagram(instagram)
      const number = normalizeWhatsApp(whatsapp)
      setSaving(true)
      const { error } = await supabase.from('social_settings').upsert({ id: 1, instagram_url: instagramUrl, whatsapp_number: number })
      if (error) throw error
      setInstagram(instagramUrl); setWhatsapp(number)
      toast.success('Sosyal medya bağlantıları kaydedildi.')
    } catch (error) { toast.error(error.message) }
    finally { setSaving(false) }
  }
  return <form className="promotion-settings" onSubmit={save}>
    <h2>Sosyal medya ve iletişim</h2><p>Karşılama ekranındaki butonları güncelleyin. Boş bırakılan bağlantının butonu gizlenir.</p>
    {error && <p role="alert">{error}</p>}
    <label htmlFor="social-instagram">Instagram kullanıcı adı veya profil bağlantısı</label>
    <input id="social-instagram" className="input" value={instagram} onChange={e => setInstagram(e.target.value)} disabled={!ready || saving} placeholder="@kullanici_adi" />
    <label htmlFor="social-whatsapp">WhatsApp telefon numarası</label>
    <input id="social-whatsapp" className="input" type="tel" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} disabled={!ready || saving} placeholder="+90 555 010 91 34" />
    <button className="btn btn-primary" disabled={!ready || saving}>{saving ? 'Kaydediliyor…' : 'Kaydet'}</button>
  </form>
}
