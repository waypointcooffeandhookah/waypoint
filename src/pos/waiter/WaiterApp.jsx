import { useCallback, useEffect, useReducer } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import toast from 'react-hot-toast'
import { cartReducer, emptyCart } from '../cart'
import { loadPending, clearPending } from '../orderSubmission'
import { orderErrorMessage } from '../messages'
import { WAITER_ROLES } from '../backend/staffAuth'
import { usePosSession } from '../usePosSession'
import PosGate from '../ui/PosGate'
import PosHeader from '../ui/PosHeader'
import TableGrid from './TableGrid'
import TableView from './TableView'
import QrOrderNotifier from './QrOrderNotifier'
import '../ui/pos.css'
import './waiter.css'

const DEMO_STAFF = { id: 'demo', name: 'Demo Garson', role: 'waiter' }
const AREA = { name: 'Garson paneli', tag: 'GARSON', hint: 'Garson hesabınızla giriş yapın.', roles: WAITER_ROLES, needsCatalog: true }

// Masa başına sepetler: masalar arasında gezinirken gönderilmemiş sepet kaybolmaz.
const cartsReducer = (carts, { tableId, action }) => ({ ...carts, [tableId]: cartReducer(carts[tableId] ?? emptyCart, action) })

export default function WaiterApp() {
  const session = usePosSession({ demoStaff: DEMO_STAFF })
  const { mode, staff, catalog, backend } = session
  const [carts, dispatchCart] = useReducer(cartsReducer, {})

  // Önceki oturumdan kalan belirsiz gönderimleri anahtarlarıyla doğrula.
  const reconcilePending = useCallback(async () => {
    if (backend?.mode !== 'live') return
    for (const submission of loadPending()) {
      const result = await backend.reconcile(submission)
      if (result.state === 'confirmed') {
        clearPending(submission.key)
        toast.success(`Bekleyen sipariş #${result.order.order_number} doğrulandı`)
      } else if (result.state === 'rejected') {
        clearPending(submission.key)
        toast.error(`Bekleyen sipariş kabul edilmedi: ${orderErrorMessage(result.code)}`)
      }
    }
  }, [backend])

  useEffect(() => {
    if (!staff || !WAITER_ROLES.includes(staff.role)) return
    reconcilePending()
    window.addEventListener('online', reconcilePending)
    return () => window.removeEventListener('online', reconcilePending)
  }, [staff, reconcilePending])

  return (
    <PosGate session={session} area={AREA}>
      <div className="pos-app">
        <PosHeader subtitle="Garson Paneli" staff={staff} demo={mode === 'demo'} onSignOut={session.signOut}
          demoLink={{ path: 'mutfak', label: 'Mutfak ekranını aç' }}
          onResetDemo={() => { if (window.confirm('Demo siparişleri silinip başlangıca dönülsün mü?')) backend.resetDemo() }} />
        {backend && <QrOrderNotifier backend={backend} />}
        {backend && (
          <Routes>
            <Route index element={<TableGrid backend={backend} carts={carts} />} />
            <Route path="masa/:tableId" element={<TableView backend={backend} catalog={catalog} carts={carts} dispatchCart={dispatchCart} />} />
            <Route path="*" element={<Navigate to="." replace />} />
          </Routes>
        )}
      </div>
    </PosGate>
  )
}
