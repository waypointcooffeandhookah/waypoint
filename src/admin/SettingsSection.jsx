import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../supabaseClient'
import { DAYS, formToSettings, posErrorMessage, settingsToForm, validateSettingsForm } from './adminData'

function Toggle({ id, label, hint, checked, onChange }) {
  return (
    <label className="ad-toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span className="ad-toggle-track" aria-hidden="true" />
      <span className="ad-toggle-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
    </label>
  )
}

export default function SettingsSection() {
  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    Promise.resolve(supabase.from('fulfillment_settings').select('*').eq('id', 1).single()).then(({ data, error }) => {
      if (!active) return
      if (error) setLoadError(true)
      else setForm(settingsToForm(data))
    })
    return () => { active = false }
  }, [])

  const set = (field, value) => setForm(current => ({ ...current, [field]: value }))
  const setDay = (day, value) => setForm(current => ({ ...current, days: { ...current.days, [day]: { ...current.days[day], ...value } } }))

  async function save(event) {
    event.preventDefault()
    const problem = validateSettingsForm(form)
    if (problem) return toast.error(problem)
    setSaving(true)
    const { data, error } = await supabase.rpc('update_ordering_settings', { p_settings: formToSettings(form) })
    setSaving(false)
    if (error) return toast.error(posErrorMessage(error))
    setForm(settingsToForm(data))
    toast.success('Ayarlar kaydedildi.')
  }

  return (
    <main className="ad-page fade-in">
      <div className="ad-page-head"><h1 className="pos-title">Sipariş Ayarları</h1></div>
      {loadError && <p className="pos-alert" role="alert">Ayarlar alınamadı. Sayfayı yenileyin.</p>}
      {!form && !loadError && <div className="loading-screen" role="status"><div className="spinner" />Yükleniyor…</div>}
      {form && (
        <form onSubmit={save} className="ad-settings">
          <section className="ad-card">
            <div className="ad-card-head"><h2>Sipariş alımı</h2></div>
            <Toggle id="set-accepting" label="Sipariş alımı açık" hint="Kapalıyken müşteriler sipariş veremez; garson siparişi ve mevcut siparişler sürer." checked={form.accepting_orders} onChange={value => set('accepting_orders', value)} />
          </section>
          <section className="ad-card">
            <div className="ad-card-head"><h2>Kanallar</h2></div>
            <Toggle id="set-dine" label="Masada Sipariş" hint="Masa QR koduyla müşteri siparişi." checked={form.dine_in_enabled} onChange={value => set('dine_in_enabled', value)} />
            <Toggle id="set-pickup" label="Paket / Gel Al" hint="Ödeme teslim alırken yapılır." checked={form.pickup_enabled} onChange={value => set('pickup_enabled', value)} />
            <Toggle id="set-delivery" label="Kurye ile Teslimat" hint="Kapıda ödeme. En az bir açık teslimat bölgesi gerekir." checked={form.delivery_enabled} onChange={value => set('delivery_enabled', value)} />
            <Toggle id="set-auto" label="Sipariş türünü otomatik sor" hint="Karşılama reklamı kapanınca sipariş türü penceresi açılır." checked={form.auto_open_order_type} onChange={value => set('auto_open_order_type', value)} />
          </section>
          <section className="ad-card">
            <div className="ad-card-head"><h2>Çalışma saatleri</h2></div>
            <Toggle id="set-hours" label="Saat sınırı uygula" hint="Açıkken seçilmeyen günlerde ve saat dışında müşteri siparişi alınmaz. Saatler Türkiye saatidir; kapanış açılıştan küçükse ertesi güne sarkar." checked={form.hours_enabled} onChange={value => set('hours_enabled', value)} />
            <ul className="ad-days">
              {DAYS.map(([day, label]) => {
                const value = form.days[day]
                return (
                  <li key={day} className="ad-day" data-day={day}>
                    <label className="ad-day-name"><input type="checkbox" checked={value.open} onChange={event => setDay(day, { open: event.target.checked })} /> {label}</label>
                    <input className="input" type="time" aria-label={`${label} açılış`} disabled={!value.open} value={value.from} onChange={event => setDay(day, { from: event.target.value })} />
                    <input className="input" type="time" aria-label={`${label} kapanış`} disabled={!value.open} value={value.to} onChange={event => setDay(day, { to: event.target.value })} />
                  </li>
                )
              })}
            </ul>
          </section>
          <div className="ad-save-bar"><button type="submit" className="pos-btn pos-btn-primary ad-settings-save" disabled={saving}>{saving ? 'Kaydediliyor…' : 'Ayarları kaydet'}</button></div>
        </form>
      )}
    </main>
  )
}
