import { Routes, Route, Outlet } from 'react-router-dom'
import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import NetworkWarning from './components/NetworkWarning'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import Marketplace from './pages/Marketplace'
import CreateListing from './pages/CreateListing'
import TradeManagement from './pages/TradeManagement'
import Reputation from './pages/Reputation'
import TokenDashboard from './pages/TokenDashboard'
import Rules from './pages/Rules'
import Admin from './pages/Admin'
import StarterTokensBanner from './components/StarterTokensBanner'
import TraderOnly from './components/TraderOnly'

// Layout for the post-connection app views (dashboard, marketplace, etc.)
// which get the persistent sidebar. The marketing landing page renders
// full-width with no sidebar, so it sits outside this layout route.
function AppShellLayout() {
  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 min-w-0">
        <StarterTokensBanner />
        <Outlet />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <NetworkWarning />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route element={<AppShellLayout />}>
            <Route path="/dashboard" element={<TraderOnly><Dashboard /></TraderOnly>} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/create" element={<TraderOnly><CreateListing /></TraderOnly>} />
            <Route path="/trades" element={<TraderOnly><TradeManagement /></TraderOnly>} />
            <Route path="/reputation" element={<Reputation />} />
            <Route path="/tokens" element={<TraderOnly><TokenDashboard /></TraderOnly>} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/admin" element={<Admin />} />
          </Route>
        </Routes>
      </main>
    </div>
  )
}
