import { useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight, ShieldCheck, Coins, Repeat, Lock, ArrowRight,
  Store, PlusCircle, Handshake, ArrowDown, CheckCircle2,
} from 'lucide-react'
import { useWallet } from '../hooks/useWallet.jsx'
import { useBarter } from '../hooks/useBarter.jsx'
import { useAsyncData } from '../hooks/useAsyncData'
import { NETWORKS } from '../blockchain/networks'
import { shortenAddress } from '../blockchain/provider'
import WalletButton from '../components/WalletButton'

const FEATURES = [
  { icon: Repeat, title: 'Barter, buy or sell', text: 'List what you have, find what you need, and trade directly — swap items or pay in ETH.' },
  { icon: Lock, title: 'On-chain escrow', text: 'Both sides lock a BTK stake — and the ETH — in a smart contract until the trade is confirmed.' },
  { icon: ShieldCheck, title: 'Reputation you own', text: 'Every rated trade builds an on-chain trust score tied to your wallet, not a platform account.' },
  { icon: Coins, title: 'Rewards and penalties', text: 'A clean trade pays a bonus of 5% of your stake per star. A fake dispute or a bad product costs you.' },
]

const STEPS = [
  { title: 'Create a listing', text: 'Post an item or service with a photo, and set the BTK stake X and the ETH amount Y.', icon: PlusCircle },
  { title: 'Match and request', text: 'Browse the marketplace and request a listing, with an optional photo of what you offer — your stake is locked in escrow.', icon: Store },
  { title: 'Accept and lock', text: 'The owner accepts and locks their side too. Now both stakes are held by the Escrow contract.', icon: Lock },
  { title: 'Confirm and rate', text: 'Swap the goods and confirm on-chain, rate each other, and get your stake back with a bonus — or open a dispute if something is wrong.', icon: Handshake },
]

export default function Landing() {
  const navigate = useNavigate()
  const { isConnected } = useWallet()
  const { service, activeChainId, deployed } = useBarter()

  // Headline numbers are counters read straight from the contract.
  const { data: stats } = useAsyncData(async () => (service ? service.fetchStats() : null), [service])
  const contracts = NETWORKS[activeChainId]?.contracts ?? {}
  const countText = (n) => (stats ? n.toLocaleString() : '—')

  return (
    <div>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-ink-border">
        <div className="absolute inset-0 bg-grain pointer-events-none" />
        <div className="max-w-7xl mx-auto px-5 sm:px-8 pt-20 pb-24 relative">
          <div className="grid lg:grid-cols-2 gap-14 items-center">
            <div>
              <span className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-copper border border-copper/30 bg-copper/5 rounded-full px-3 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-copper animate-pulseRing" />
                Local prototype · Hardhat network
              </span>
              <h1 className="font-display font-semibold text-4xl sm:text-5xl lg:text-6xl leading-[1.05] mt-6 text-parchment">
                Trade goods and services.
                <br />
                <span className="text-copper">No currency required.</span>
              </h1>
              <p className="text-parchment-muted text-lg mt-6 max-w-lg">
                Trove is a decentralized barter marketplace. List what you have, request what you need,
                and let on-chain escrow hold both sides to the deal.
              </p>
              <div className="flex flex-wrap items-center gap-3 mt-8">
                {isConnected ? (
                  <button onClick={() => navigate('/dashboard')} className="btn-primary">
                    Go to Dashboard <ArrowRight size={16} />
                  </button>
                ) : (
                  <WalletButton />
                )}
                <button onClick={() => navigate('/marketplace')} className="btn-secondary">
                  Browse Marketplace
                </button>
              </div>
              <div className="flex items-center gap-6 mt-10 text-sm text-parchment-muted">
                <div>
                  <p className="font-display text-2xl text-parchment font-semibold">{countText(stats?.totalListings ?? 0)}</p>
                  <p>Listings on-chain</p>
                </div>
                <div className="h-8 w-px bg-ink-border" />
                <div>
                  <p className="font-display text-2xl text-parchment font-semibold">{countText(stats?.totalTradeRequests ?? 0)}</p>
                  <p>Trade requests</p>
                </div>
              </div>
            </div>

            {/* Signature visual: an exchange ledger card, echoed from the marketplace listing design */}
            <div className="relative">
              <div className="card p-6 shadow-glass max-w-md mx-auto">
                <div className="flex items-center justify-between mb-5">
                  <span className="label">Sample Exchange</span>
                  <ArrowLeftRight size={16} className="text-copper" />
                </div>
                <div className="flex items-stretch gap-3">
                  <div className="flex-1 rounded-lg border border-ink-border bg-ink p-3.5">
                    <p className="label mb-1">Offering</p>
                    <p className="text-sm text-parchment font-medium">Mechanical Keyboard</p>
                    <p className="text-xs text-parchment-faint mt-1">from 0x7a3F…9Db2</p>
                  </div>
                  <div className="flex flex-col items-center justify-center px-2">
                    <span className="h-9 w-9 grid place-items-center rounded-full bg-copper/10 border border-copper/30">
                      <Lock size={14} className="text-copper" />
                    </span>
                    <span className="font-mono text-[10px] text-parchment-faint mt-1">100 BTK + ETH each</span>
                  </div>
                  <div className="flex-1 rounded-lg border border-ink-border bg-ink p-3.5 text-right">
                    <p className="label mb-1">Seeking</p>
                    <p className="text-sm text-parchment font-medium">Audio Interface</p>
                    <p className="text-xs text-parchment-faint mt-1">from 0x4B1a…c77E</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-5 text-xs text-ledger">
                  <CheckCircle2 size={14} />
                  Both confirmed — stakes returned with bonuses
                </div>
              </div>
              <div className="absolute -z-10 -right-8 -bottom-8 h-40 w-40 rounded-full bg-ledger/10 blur-3xl" />
              <div className="absolute -z-10 -left-8 -top-8 h-40 w-40 rounded-full bg-copper/10 blur-3xl" />
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="max-w-7xl mx-auto px-5 sm:px-8 py-20">
        <div className="max-w-xl mb-12">
          <p className="label mb-2">Why Trove</p>
          <h2 className="font-display font-semibold text-3xl text-parchment">Built for trust between strangers</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="card p-5 hover:border-copper/25 transition-colors">
              <span className="grid place-items-center h-10 w-10 rounded-lg bg-copper/10 border border-copper/25 mb-4">
                <Icon size={18} className="text-copper" />
              </span>
              <h3 className="font-display font-semibold text-parchment mb-1.5">{title}</h3>
              <p className="text-sm text-parchment-muted leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-y border-ink-border bg-ink-surface/40">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-20">
          <div className="max-w-xl mb-14">
            <p className="label mb-2">How barter works</p>
            <h2 className="font-display font-semibold text-3xl text-parchment">Four steps from listing to handoff</h2>
          </div>
          <div className="grid md:grid-cols-4 gap-6">
            {STEPS.map(({ title, text, icon: Icon }, i) => (
              <div key={title} className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <span className="grid place-items-center h-9 w-9 rounded-full border border-ledger/30 bg-ledger/10 text-ledger font-mono text-sm font-semibold">
                    {i + 1}
                  </span>
                  <Icon size={17} className="text-parchment-muted" />
                </div>
                <h3 className="font-display font-semibold text-parchment mb-1.5">{title}</h3>
                <p className="text-sm text-parchment-muted leading-relaxed">{text}</p>
                {i < STEPS.length - 1 && (
                  <ArrowDown size={16} className="md:hidden text-ink-border mt-4" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECURITY / TRUST */}
      <section className="max-w-7xl mx-auto px-5 sm:px-8 py-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="label mb-2">Security & trust</p>
            <h2 className="font-display font-semibold text-3xl text-parchment mb-5">
              Neither side can walk away with both items
            </h2>
            <p className="text-parchment-muted leading-relaxed mb-6">
              Every trade routes through the Escrow contract. Both sides lock on-chain before anything is
              exchanged, and the funds only release once the trade is confirmed. If something goes wrong — including a
              buyer who never confirms — either side can raise a dispute, and a fake dispute or a bad product costs the
              person at fault their stake. Once everything is locked, both sides can also agree to call the trade off.
            </p>
            <ul className="space-y-3">
              {[
                'Stakes and ETH are held by a non-custodial Escrow contract (a prototype — not audited)',
                'Reputation and dispute history are public and wallet-bound',
                'The app never holds your assets — the backend only stores photos and sign-in sessions',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-parchment-muted">
                  <CheckCircle2 size={16} className="text-ledger mt-0.5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="label">Deployed contracts</span>
              <ShieldCheck size={16} className="text-ledger" />
            </div>
            <div className="space-y-2.5">
              {['BarterToken', 'Escrow', 'BarterAgreement', 'Reputation'].map((c) => (
                <div key={c} className="flex items-center justify-between rounded-lg bg-ink border border-ink-border px-3.5 py-2.5">
                  <span className="font-mono text-sm text-parchment">{c}.sol</span>
                  <span className={`text-[11px] font-mono ${deployed ? 'text-ledger' : 'text-signal-warn'}`}>
                    {deployed && contracts[c] ? shortenAddress(contracts[c], 5) : 'not deployed'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-5 sm:px-8 pb-24">
        <div className="card p-10 sm:p-14 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-grain pointer-events-none" />
          <h2 className="font-display font-semibold text-3xl sm:text-4xl text-parchment relative">
            Your first trade is a wallet away
          </h2>
          <p className="text-parchment-muted mt-3 max-w-md mx-auto relative">
            Connect a wallet, list something you're ready to trade, and let escrow handle the rest.
          </p>
          <div className="flex items-center justify-center gap-3 mt-8 relative">
            <WalletButton />
            <button onClick={() => navigate('/marketplace')} className="btn-secondary">
              Explore Listings
            </button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-ink-border">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center h-7 w-7 rounded-lg bg-copper/15 border border-copper/30">
              <ArrowLeftRight size={14} className="text-copper" />
            </span>
            <span className="font-display font-semibold">Trove</span>
          </div>
          <p className="text-xs text-parchment-faint">
            Built on Ethereum · BarterToken · Escrow · BarterAgreement · Reputation
          </p>
          <p className="text-xs text-parchment-faint">© {new Date().getFullYear()} Trove Protocol</p>
        </div>
      </footer>
    </div>
  )
}
