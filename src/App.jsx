import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { isAdmin } from './utils/adminAccess'
import GeneralMenuRoute from './pages/GeneralMenuRoute'
const LoginPage = lazy(() => import('./pages/LoginPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const WaiterApp = lazy(() => import('./pos/waiter/WaiterApp'))
const KitchenApp = lazy(() => import('./pos/kitchen/KitchenApp'))
const QrOrderRoute = lazy(() => import('./pos/customer/QrOrderRoute'))
const OrderTrackingPage = lazy(() => import('./pos/customer/OrderTrackingPage'))
const FulfillmentApp = lazy(() => import('./pos/fulfillment/FulfillmentApp'))

function ProtectedRoute({ children }) {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return null // loading
  if (!session) return <Navigate to="/admin/login" replace />
  if (!isAdmin(session.user)) return <div className="loading-screen" role="alert">Bu hesabın yönetici yetkisi bulunmuyor. <a href={import.meta.env.BASE_URL}>Menüye dön</a></div>
  return children
}

export default function App() {
  return (
    <Suspense fallback={<div className="loading-screen" role="status">Yükleniyor…</div>}>
    <Routes>
      <Route path="/" element={<GeneralMenuRoute />} />
      <Route path="/admin/login" element={<LoginPage />} />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminPage />
          </ProtectedRoute>
        }
      />
      <Route path="/garson/*" element={<WaiterApp />} />
      <Route path="/mutfak" element={<KitchenApp />} />
      <Route path="/masa/:tableToken" element={<QrOrderRoute />} />
      <Route path="/siparis/:token" element={<OrderTrackingPage />} />
      <Route path="/siparisler" element={<FulfillmentApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}

