import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../supabaseClient'
import { STAFF_ROLES, posErrorMessage } from './adminData'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Şifre ve hesap oluşturma tarayıcıdan yapılmaz (service_role gerektirir); burada rol ve erişim yönetilir.
export default function StaffSection() {
  const [staff, setStaff] = useState(null)
  const [me, setMe] = useState(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState({ id: '', name: '', role: 'waiter' })

  const load = useCallback(async () => {
    const [{ data, error: failure }, session] = await Promise.all([
      supabase.from('staff_profiles').select('user_id, display_name, role, is_active').order('display_name'),
      supabase.auth.getSession(),
    ])
    setError(Boolean(failure))
    if (!failure) setStaff(data)
    setMe(session.data.session?.user.id ?? null)
  }, [])
  useEffect(() => { queueMicrotask(load) }, [load])

  async function upsert(person, change, success) {
    setBusy(true)
    const next = { ...person, ...change }
    const { error: failure } = await supabase.rpc('upsert_staff_profile', { p_user_id: next.user_id, p_display_name: next.display_name, p_role: next.role, p_is_active: next.is_active })
    setBusy(false)
    if (failure) toast.error(/foreign key|violates/.test(failure.message) ? 'Bu kimlikle bir hesap bulunamadı.' : posErrorMessage(failure))
    else toast.success(success)
    await load()
    return !failure
  }

  async function add(event) {
    event.preventDefault()
    if (!UUID.test(draft.id.trim())) return toast.error('Geçerli bir kullanıcı kimliği girin.')
    if (!draft.name.trim()) return toast.error('Ad girin.')
    if (await upsert({ user_id: draft.id.trim(), display_name: draft.name.trim(), role: draft.role, is_active: true }, {}, 'Personel eklendi.')) setDraft({ id: '', name: '', role: 'waiter' })
  }

  return (
    <main className="ad-page fade-in">
      <div className="ad-page-head"><h1 className="pos-title">Personel</h1></div>
      {error && <p className="pos-alert" role="alert">Personel listesi alınamadı.</p>}
      {!staff && !error && <div className="loading-screen" role="status"><div className="spinner" />Yükleniyor…</div>}
      <ul className="ad-staff">
        {staff?.map(person => {
          const self = person.user_id === me
          return (
            <li key={person.user_id} className={`ad-person${person.is_active ? '' : ' inactive'}`} data-person={person.display_name}>
              <div className="ad-order-head">
                <strong>{person.display_name}</strong>
                {self && <span className="ad-channel-tag busy">Siz</span>}
                {!person.is_active && <span className="ad-channel-tag">Pasif</span>}
              </div>
              <div className="ad-row-actions">
                <select className="input ad-role" aria-label={`${person.display_name} rolü`} value={person.role} disabled={busy || self} onChange={event => upsert(person, { role: event.target.value }, 'Rol güncellendi.')}>
                  {Object.entries(STAFF_ROLES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <button type="button" className="pos-btn pos-btn-ghost ad-person-toggle" disabled={busy || self} onClick={() => upsert(person, { is_active: !person.is_active }, person.is_active ? 'Erişim kapatıldı.' : 'Erişim açıldı.')}>{person.is_active ? 'Erişimi kapat' : 'Erişimi aç'}</button>
              </div>
            </li>
          )
        })}
      </ul>
      <section className="ad-card">
        <div className="ad-card-head"><h2>Personel ekle</h2></div>
        <p className="pos-muted">Önce hesabı Supabase panelinde (Authentication → Users) oluşturun, kullanıcı kimliğini buraya girin. Şifreler bu ekrandan yönetilmez. Rol değişikliği oturum açık cihazlarda hemen geçerli olur; bu panele giriş ayrıca hesapta yönetici yetkisi gerektirir.</p>
        <form className="ad-zone-form" onSubmit={add}>
          <div className="ad-field"><label className="input-label" htmlFor="ad-staff-id">Kullanıcı kimliği</label><input id="ad-staff-id" className="input" value={draft.id} onChange={event => setDraft({ ...draft, id: event.target.value })} /></div>
          <div className="ad-field"><label className="input-label" htmlFor="ad-staff-name">Ad</label><input id="ad-staff-name" className="input" maxLength={60} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></div>
          <div className="ad-field"><label className="input-label" htmlFor="ad-staff-role">Rol</label>
            <select id="ad-staff-role" className="input" value={draft.role} onChange={event => setDraft({ ...draft, role: event.target.value })}>
              {Object.entries(STAFF_ROLES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
          <button type="submit" className="pos-btn pos-btn-primary" disabled={busy}>Ekle</button>
        </form>
      </section>
    </main>
  )
}
