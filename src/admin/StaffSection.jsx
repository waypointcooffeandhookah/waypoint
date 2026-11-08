import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../supabaseClient'
import { ASSIGNABLE_ROLES, STAFF_ROLES, callStaffAccount, posErrorMessage, staffAccountMessage } from './adminData'

const EMPTY = { name: '', email: '', password: '', role: 'waiter' }

// Hesap açma ve şifre değiştirme sunucudaki staff-account fonksiyonuyla yapılır (gizli anahtar tarayıcıya gelmez);
// rol ve erişim upsert_staff_profile ile yönetilir.
// Garson | Mutfak seçici: açılır liste yerine iki düğme (koyu temada net okunur, telefonda tek dokunuş, klavyeyle ok tuşları).
function RolePicker({ value, onChange, disabled, label, name }) {
  const pick = (role, event) => { if (role !== value) onChange(role); event?.currentTarget?.focus() }
  const onKeyDown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const index = ASSIGNABLE_ROLES.indexOf(value)
    const next = ASSIGNABLE_ROLES[(index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + ASSIGNABLE_ROLES.length) % ASSIGNABLE_ROLES.length]
    onChange(next)
    event.currentTarget.parentElement?.querySelector(`[data-role="${next}"]`)?.focus()
  }
  return (
    <div className="ad-role-picker" role="radiogroup" aria-label={label} data-name={name}>
      {ASSIGNABLE_ROLES.map(role => (
        <button key={role} type="button" role="radio" data-role={role} aria-checked={value === role} tabIndex={value === role || !ASSIGNABLE_ROLES.includes(value) ? 0 : -1}
          className={value === role ? 'active' : ''} disabled={disabled} onClick={event => pick(role, event)} onKeyDown={onKeyDown}>
          {STAFF_ROLES[role]}
        </button>
      ))}
    </div>
  )
}

export default function StaffSection() {
  const [staff, setStaff] = useState(null)
  const [me, setMe] = useState(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(EMPTY)
  const [passwordFor, setPasswordFor] = useState(null) // { userId, value }

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
    if (busy) return
    const name = draft.name.trim(), email = draft.email.trim()
    if (!name) return toast.error('Ad girin.')
    if (draft.password.length < 8) return toast.error(staffAccountMessage('weak_password'))
    setBusy(true)
    const result = await callStaffAccount(supabase, { action: 'create', email, displayName: name, role: draft.role, password: draft.password })
    setBusy(false)
    if (!result.ok) return toast.error(staffAccountMessage(result.code))
    toast.success(result.data?.linked
      ? `${name} eklendi. Bu e-posta zaten kayıtlıydı; eski şifresi geçerli.`
      : `${name} eklendi. ${email} ve verdiğiniz şifreyle giriş yapabilir.`, { duration: 6000 })
    setDraft(EMPTY)
    load()
  }

  async function savePassword(event) {
    event.preventDefault()
    if (busy || !passwordFor) return
    if (passwordFor.value.length < 8) return toast.error(staffAccountMessage('weak_password'))
    setBusy(true)
    const result = await callStaffAccount(supabase, { action: 'set_password', userId: passwordFor.userId, password: passwordFor.value })
    setBusy(false)
    if (!result.ok) return toast.error(staffAccountMessage(result.code))
    toast.success('Şifre değiştirildi. Yeni şifre bir sonraki girişte geçerli.')
    setPasswordFor(null)
  }

  return (
    <main className="ad-page fade-in">
      <div className="ad-page-head"><h1 className="pos-title">Personel</h1></div>
      {error && <p className="pos-alert" role="alert">Personel listesi alınamadı.</p>}
      {!staff && !error && <div className="loading-screen" role="status"><div className="spinner" />Yükleniyor…</div>}
      <ul className="ad-staff">
        {staff?.map(person => {
          const self = person.user_id === me
          const editing = passwordFor?.userId === person.user_id
          const isAdmin = person.role === 'admin'
          return (
            <li key={person.user_id} className={`ad-person${person.is_active ? '' : ' inactive'}`} data-person={person.display_name}>
              <div className="ad-order-head">
                <strong>{person.display_name}</strong>
                {isAdmin && <span className="ad-channel-tag">Admin</span>}
                {self && <span className="ad-channel-tag busy">Siz</span>}
                {!person.is_active && <span className="ad-channel-tag">Pasif</span>}
              </div>
              <div className="ad-row-actions">
                {!isAdmin && <RolePicker value={person.role} disabled={busy} label={`${person.display_name} rolü`} name={person.display_name}
                      onChange={role => upsert(person, { role }, `${person.display_name}: ${STAFF_ROLES[role]}`)} />}
                {!isAdmin && <button type="button" className="pos-btn pos-btn-ghost ad-person-toggle" disabled={busy || self} onClick={() => upsert(person, { is_active: !person.is_active }, person.is_active ? 'Erişim kapatıldı.' : 'Erişim açıldı.')}>{person.is_active ? 'Erişimi kapat' : 'Erişimi aç'}</button>}
                <button type="button" className="pos-btn pos-btn-ghost ad-person-toggle" disabled={busy} aria-expanded={editing}
                  onClick={() => setPasswordFor(editing ? null : { userId: person.user_id, value: '' })}>Şifre değiştir</button>
              </div>
              {editing && (
                <form className="ad-row-actions" onSubmit={savePassword}>
                  <input className="input" type="text" autoComplete="new-password" autoCapitalize="none" minLength={8} maxLength={72} autoFocus
                    placeholder="Yeni şifre (en az 8 karakter)" aria-label={`${person.display_name} yeni şifre`}
                    value={passwordFor.value} onChange={event => setPasswordFor({ ...passwordFor, value: event.target.value })} />
                  <button type="submit" className="pos-btn pos-btn-primary" disabled={busy}>Kaydet</button>
                </form>
              )}
            </li>
          )
        })}
      </ul>
      <section className="ad-card">
        <div className="ad-card-head"><h2>Personel ekle</h2></div>
        <p className="pos-muted">Hesap burada açılır; kişi bu e-posta ve şifreyle garson/mutfak ekranına girer. Şifreyi kişiye kendiniz iletin; gerekirse "Şifre değiştir" ile yenileyin. Personel Garson veya Mutfak olabilir; sistemde tek Admin hesabı vardır.</p>
        <form className="ad-zone-form" onSubmit={add}>
          <div className="ad-field"><label className="input-label" htmlFor="ad-staff-name">Ad</label>
            <input id="ad-staff-name" className="input" maxLength={60} autoComplete="off" placeholder="Örn. Ayşe" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></div>
          <div className="ad-field"><label className="input-label" htmlFor="ad-staff-email">E-posta</label>
            <input id="ad-staff-email" className="input" type="email" inputMode="email" autoComplete="off" autoCapitalize="none" placeholder="ayse@ornek.com" required value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })} /></div>
          <div className="ad-field"><label className="input-label" htmlFor="ad-staff-password">Şifre</label>
            <input id="ad-staff-password" className="input" type="text" autoComplete="new-password" autoCapitalize="none" minLength={8} maxLength={72} placeholder="En az 8 karakter" required value={draft.password} onChange={event => setDraft({ ...draft, password: event.target.value })} /></div>
          <div className="ad-field"><span className="input-label" id="ad-staff-role">Rol</span>
            <RolePicker value={draft.role} disabled={busy} label="Yeni personelin rolü" onChange={role => setDraft({ ...draft, role })} />
          </div>
          <button type="submit" className="pos-btn pos-btn-primary" disabled={busy}>{busy ? 'Hesap açılıyor…' : 'Hesap aç ve ekle'}</button>
        </form>
      </section>
    </main>
  )
}
