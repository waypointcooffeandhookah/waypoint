import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, FlaskConical, Lock, Mail } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { signInStaff } from '../backend/staffAuth'
import '../../pages/LoginPage.css'

const ERRORS = {
  credentials: 'E-posta veya şifre hatalı.',
}

export default function StaffLogin({ demo, area, onSignedIn, onStartDemo }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = await signInStaff(supabase, email, password, area.roles)
      if (result.error) setError(ERRORS[result.error] ?? `Bu hesabın ${area.name.toLocaleLowerCase('tr')} yetkisi bulunmuyor.`)
      else onSignedIn(result.staff)
    } catch {
      setError('Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card fade-up">
        <Link to="/" className="back-link"><ArrowLeft size={14} /> Menüye dön</Link>

        <div className="login-logo">
          <img src={`${import.meta.env.BASE_URL}logo-balanced.png`} alt="Waypoint Logo" className="login-logo-img" />
          <div className="login-logo-text">
            <span className="login-logo-name">WAYPOINT</span>
            <span className="login-logo-sub">COFFEE & HOOKAH • {area.tag}</span>
          </div>
        </div>

        <h1 className="login-title">Personel Girişi</h1>

        {demo ? (
          <div className="pos-login-demo">
            <p className="pos-login-demo-tag"><FlaskConical size={15} aria-hidden="true" /> DEMO MODU</p>
            <p>Sipariş veritabanı henüz kurulmadı. Ekranı gerçek menü ürünleri ve <strong>örnek masalarla</strong> deneyebilirsiniz.</p>
            <p className="pos-login-demo-muted">Demo siparişleri gerçek mutfağa gitmez; yalnızca bu tarayıcıda saklanır ve aynı tarayıcının sekmeleri arasında eşitlenir. Gerçek personel girişi, veritabanı kurulumu onaylanıp uygulandıktan sonra açılır.</p>
            <button className="login-btn" type="button" onClick={onStartDemo}>Demo'yu Başlat</button>
          </div>
        ) : (
          <>
            <p className="login-subtitle">{area.hint}</p>
            <form className="login-form" onSubmit={handleLogin}>
              <div className="input-group">
                <label className="input-label" htmlFor="staff-email">E-posta</label>
                <div className="pos-input-icon">
                  <Mail size={15} aria-hidden="true" />
                  <input id="staff-email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" />
                </div>
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="staff-password">Şifre</label>
                <div className="pos-input-icon">
                  <Lock size={15} aria-hidden="true" />
                  <input id="staff-password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
                </div>
              </div>
              {error && <p className="pos-form-error" role="alert">{error}</p>}
              <button className="login-btn" type="submit" disabled={loading}>{loading ? 'Giriş yapılıyor…' : 'Giriş Yap'}</button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
