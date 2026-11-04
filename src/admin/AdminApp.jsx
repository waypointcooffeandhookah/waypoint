import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, Navigate, NavLink, useNavigate, useParams } from 'react-router-dom'
import { Bike, ChefHat, ClipboardList, Eye, LayoutDashboard, LogOut, Settings, Soup, Table2, Users, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../supabaseClient'
import AdminPage from '../pages/AdminPage'
import DashboardSection from './DashboardSection'
import OrdersSection from './OrdersSection'
import SettingsSection from './SettingsSection'
import StaffSection from './StaffSection'
import TablesSection from './TablesSection'
import '../pos/ui/pos.css'
import './admin.css'

const DeliverySection = lazy(() => import('./DeliverySection'))
const RevenueSection = lazy(() => import('./RevenueSection'))

const SECTIONS = [
  { key: '', label: 'Panel', Icon: LayoutDashboard, element: <DashboardSection /> },
  { key: 'menu', label: 'Menü', Icon: Soup, element: <AdminPage embedded /> },
  { key: 'siparisler', label: 'Siparişler', Icon: ClipboardList, element: <OrdersSection /> },
  { key: 'ciro', label: 'Ciro', Icon: Wallet, element: <Suspense fallback={null}><RevenueSection /></Suspense> },
  { key: 'masalar', label: 'Masalar', Icon: Table2, element: <TablesSection /> },
  { key: 'teslimat', label: 'Teslimat', Icon: Bike, element: <Suspense fallback={null}><DeliverySection /></Suspense> },
  { key: 'ayarlar', label: 'Sipariş Ayarları', Icon: Settings, element: <SettingsSection /> },
  { key: 'personel', label: 'Personel', Icon: Users, element: <StaffSection /> },
]

// Yönetim merkezi. POS kurulu değilse (üretimin bugünkü hali) mevcut menü yönetimi aynen açılır.
export default function AdminApp() {
  const { section = '' } = useParams()
  const navigate = useNavigate()
  const [mode, setMode] = useState('loading')

  useEffect(() => {
    let active = true
    Promise.resolve(supabase.rpc('get_ordering_config')).then(({ error }) => {
      if (active) setMode(['PGRST202', '42883'].includes(error?.code) ? 'legacy' : 'pos')
    }, () => { if (active) setMode('pos') })
    return () => { active = false }
  }, [])

  if (mode === 'loading') return <div className="loading-screen" role="status"><div className="spinner" />Yönetim paneli hazırlanıyor…</div>
  if (mode === 'legacy') return <AdminPage />
  const current = SECTIONS.find(item => item.key === section)
  if (!current) return <Navigate to="/admin" replace />

  async function signOut() {
    await supabase.auth.signOut()
    toast.success('Çıkış yapıldı.')
    navigate('/admin/login')
  }

  return (
    <div className="ad-shell">
      <aside className="ad-side">
        <div className="ad-brand">
          <img src={`${import.meta.env.BASE_URL}logo-balanced.png`} alt="" className="pos-brand-logo" />
          <div className="pos-brand-text">
            <span className="pos-brand-name">WAYPOINT</span>
            <span className="pos-brand-sub">Yönetim</span>
          </div>
          <div className="ad-brand-actions">
            <Link to="/" className="pos-icon-btn" aria-label="Menüyü gör"><Eye size={17} /></Link>
            <button type="button" className="pos-icon-btn" onClick={signOut} aria-label="Çıkış yap"><LogOut size={17} /></button>
          </div>
        </div>
        <nav className="ad-nav" aria-label="Yönetim bölümleri">
          {SECTIONS.map(({ key, label, Icon }) => (
            <NavLink key={key} to={key ? `/admin/${key}` : '/admin'} end className={({ isActive }) => `ad-nav-link${isActive ? ' active' : ''}`}>
              <Icon size={17} aria-hidden="true" /><span>{label}</span>
            </NavLink>
          ))}
          <Link to="/mutfak" className="ad-nav-link ad-nav-kitchen"><ChefHat size={17} aria-hidden="true" /><span>Mutfak Ekranı</span></Link>
        </nav>
      </aside>
      <div className="ad-main">{current.element}</div>
    </div>
  )
}
