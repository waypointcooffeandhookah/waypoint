import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../supabaseClient'
import './LoginPage.css'
import { isAdmin } from '../utils/adminAccess'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      toast.error('E-posta veya şifre hatalı.')
    } else if (!isAdmin(data.user)) {
      await supabase.auth.signOut()
      toast.error('Bu hesabın yönetici yetkisi bulunmuyor.')
    } else {
      toast.success('Giriş başarılı!')
      navigate('/admin')
    }
  }

  return (
    <div className="login-page">
      <div className="login-card fade-up">
        <Link to="/" className="back-link">
          <ArrowLeft size={14} /> Menüye dön
        </Link>

        <div className="login-logo">
          <img
              src={`${import.meta.env.BASE_URL}logo-balanced.png`}
            alt="Waypoint Logo"
            className="login-logo-img"
          />
          <div className="login-logo-text">
            <span className="login-logo-name">WAYPOINT</span>
            <span className="login-logo-sub">COFFEE & HOOKAH • ADMİN</span>
          </div>
        </div>

        <h1 className="login-title">Yönetici Girişi</h1>
        <p className="login-subtitle">Lütfen yetkili hesabınızla giriş yapın.</p>

        <form className="login-form" onSubmit={handleLogin}>
          <div className="input-group">
            <label className="input-label" htmlFor="login-email">E-posta</label>
            <div style={{ position: 'relative' }}>
              <Mail size={15} style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }} />
              <input
                id="login-email"
                className="input"
                style={{ paddingLeft: 42 }}
                type="email"
                placeholder="admin@ornek.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="login-password">Şifre</label>
            <div style={{ position: 'relative' }}>
              <Lock size={15} style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }} />
              <input
                id="login-password"
                className="input"
                style={{ paddingLeft: 42 }}
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          </div>

          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'Giriş yapılıyor…' : 'Giriş Yap'}
          </button>
        </form>

        <div className="login-footer">
          <p>© <span>Mehmet Ali ERDOĞAN</span></p>
        </div>
      </div>
    </div>
  )
}
