import { KITCHEN_ROLES } from '../backend/staffAuth'
import { usePosSession } from '../usePosSession'
import PosGate from '../ui/PosGate'
import PosHeader from '../ui/PosHeader'
import KitchenBoard from './KitchenBoard'
import '../ui/pos.css'
import './kitchen.css'

const DEMO_STAFF = { id: 'demo', name: 'Demo Mutfak', role: 'kitchen' }
const AREA = { name: 'Mutfak ekranı', tag: 'MUTFAK', hint: 'Mutfak hesabınızla giriş yapın.', roles: KITCHEN_ROLES, needsCatalog: false }

export default function KitchenApp() {
  const session = usePosSession({ demoStaff: DEMO_STAFF })
  const { mode, staff, backend } = session

  return (
    <PosGate session={session} area={AREA}>
      <div className="pos-app">
        <PosHeader subtitle="Mutfak Ekranı" staff={staff} demo={mode === 'demo'} onSignOut={session.signOut}
          demoLink={{ path: 'garson', label: 'Garson panelini aç' }}
          onResetDemo={() => { if (window.confirm('Demo siparişleri silinip başlangıca dönülsün mü?')) backend.resetDemo() }} />
        {backend && <KitchenBoard backend={backend} />}
      </div>
    </PosGate>
  )
}
