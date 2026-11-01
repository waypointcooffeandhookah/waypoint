import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../supabaseClient'
import { Board } from '../pos/fulfillment/FulfillmentApp'
import { centsToLira, conflictingPostal, liraToCents, parseDistricts, parsePostalCodes, posErrorMessage } from './adminData'
import { adminBackend } from './useAdminSync'

const emptyZone = { name: '', postal: '', districts: '', fee: '', minimum: '0' }

function toRow(form, zones, ownId = null) {
  const postal_codes = parsePostalCodes(form.postal)
  const fee_cents = liraToCents(form.fee), min_order_cents = liraToCents(form.minimum)
  if (!form.name.trim()) return { problem: 'Bölge adını girin.' }
  if (!postal_codes) return { problem: 'Posta kodları 5 haneli olmalı; virgülle ayırın.' }
  const conflict = conflictingPostal(postal_codes, zones ?? [], ownId)
  if (conflict) return { problem: conflict + ' posta kodu başka bir açık bölgede.' }
  if (fee_cents === null) return { problem: 'Teslimat ücretini girin.' }
  if (min_order_cents === null) return { problem: 'Asgari tutarı girin.' }
  return { row: { name: form.name.trim(), postal_codes, districts: parseDistricts(form.districts), fee_cents, min_order_cents } }
}

const toForm = zone => ({ name: zone.name, postal: zone.postal_codes.join(', '), districts: zone.districts.join(', '), fee: centsToLira(zone.fee_cents), minimum: centsToLira(zone.min_order_cents) })

function ZoneForm({ value, onChange, onSubmit, submitLabel, busy, id }) {
  const field = (name, label, props = {}) => (
    <div className="ad-field">
      <label className="input-label" htmlFor={`${id}-${name}`}>{label}</label>
      <input id={`${id}-${name}`} className="input" value={value[name]} onChange={event => onChange({ ...value, [name]: event.target.value })} {...props} />
    </div>
  )
  return (
    <form className="ad-zone-form" onSubmit={onSubmit}>
      {field('name', 'Bölge adı', { maxLength: 80 })}
      {field('postal', 'Posta kodları', { placeholder: '34000, 34001', inputMode: 'numeric' })}
      {field('districts', 'İlçeler (isteğe bağlı)', { placeholder: 'Boş bırakılırsa ilçe denetlenmez' })}
      {field('fee', 'Teslimat ücreti (₺)', { inputMode: 'decimal' })}
      {field('minimum', 'Asgari sipariş (₺)', { inputMode: 'decimal' })}
      <button type="submit" className="pos-btn pos-btn-primary ad-zone-save" disabled={busy}>{submitLabel}</button>
    </form>
  )
}

export default function DeliverySection() {
  const [zones, setZones] = useState(null)
  const [error, setError] = useState(false)
  const [draft, setDraft] = useState(emptyZone)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error: failure } = await supabase.from('delivery_zones').select('*').order('created_at')
    setError(Boolean(failure))
    if (!failure) setZones(data)
  }, [])
  useEffect(() => { queueMicrotask(load) }, [load])

  async function save(action, success) {
    setBusy(true)
    const { error: failure } = await action()
    setBusy(false)
    if (failure) toast.error(/delivery_zones_postal_format/.test(failure.message) ? 'Posta kodları 5 haneli olmalı.' : posErrorMessage(failure))
    else toast.success(success)
    await load()
    return !failure
  }

  function toggleZone(zone) {
    const conflict = zone.is_active ? null : conflictingPostal(zone.postal_codes, zones, zone.id)
    if (conflict) return toast.error(conflict + ' posta kodu başka bir açık bölgede.')
    save(() => supabase.from('delivery_zones').update({ is_active: !zone.is_active }).eq('id', zone.id), zone.is_active ? 'Bölge kapatıldı.' : 'Bölge açıldı.')
  }

  async function addZone(event) {
    event.preventDefault()
    const { row, problem } = toRow(draft, zones)
    if (problem) return toast.error(problem)
    if (await save(() => supabase.from('delivery_zones').insert(row), 'Bölge eklendi.')) setDraft(emptyZone)
  }

  async function updateZone(event) {
    event.preventDefault()
    const { row, problem } = toRow(editing.form, zones, editing.id)
    if (problem) return toast.error(problem)
    if (await save(() => supabase.from('delivery_zones').update(row).eq('id', editing.id), 'Bölge güncellendi.')) setEditing(null)
  }

  return (
    <main className="ad-page fade-in">
      <div className="ad-page-head"><h1 className="pos-title">Teslimat</h1></div>
      <section className="ad-card">
        <div className="ad-card-head"><h2>Teslimat bölgeleri</h2></div>
        <p className="pos-muted">Müşterinin posta kodu burada yoksa kurye siparişi sunucuda reddedilir. Geçmiş siparişler için bölgeler silinmez, kapatılır.</p>
        {error && <p className="pos-alert" role="alert">Bölgeler alınamadı.</p>}
        <ul className="ad-zones">
          {zones?.map(zone => (
            <li key={zone.id} className={`ad-zone${zone.is_active ? '' : ' inactive'}`} data-zone={zone.name}>
              {editing?.id === zone.id ? (
                <ZoneForm id={`edit-${zone.id}`} value={editing.form} onChange={form => setEditing({ id: zone.id, form })} onSubmit={updateZone} submitLabel="Kaydet" busy={busy} />
              ) : (
                <>
                  <div className="ad-order-head">
                    <strong>{zone.name}</strong>
                    <span className={`ad-channel-tag${zone.is_active ? ' busy' : ''}`}>{zone.is_active ? 'Açık' : 'Kapalı'}</span>
                  </div>
                  <p className="ad-bill-line">{zone.postal_codes.join(', ')}{zone.districts.length ? ` · ${zone.districts.join(', ')}` : ''}</p>
                  <p className="ad-bill-line">Ücret ₺{centsToLira(zone.fee_cents)} · Asgari ₺{centsToLira(zone.min_order_cents)}</p>
                  <div className="ad-row-actions">
                    <button type="button" className="pos-btn pos-btn-ghost ad-zone-edit" onClick={() => setEditing({ id: zone.id, form: toForm(zone) })}>Düzenle</button>
                    <button type="button" className="pos-btn pos-btn-ghost ad-zone-toggle" disabled={busy} onClick={() => toggleZone(zone)}>{zone.is_active ? 'Kapat' : 'Aç'}</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
        <h3 className="ad-subtitle">Yeni bölge</h3>
        <ZoneForm id="new-zone" value={draft} onChange={setDraft} onSubmit={addZone} submitLabel="Bölge ekle" busy={busy} />
      </section>
      <Board backend={adminBackend} role="admin" />
    </main>
  )
}
