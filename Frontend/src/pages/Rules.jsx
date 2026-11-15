import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Lock, Handshake, Star, Gavel, Flame, Coins, Clock, ArrowRight, Truck, PackageCheck, Ban, Repeat, Tag, HandCoins, Camera, Undo2,
} from 'lucide-react'
import StarRating from '../components/StarRating'
import { useRules } from '../hooks/useRules'
import { formatBtk, formatDuration } from '../utils/format'

// ─── The three workflows, as step lists ──────────────────────────────────────

const BARTER_STEPS = [
  {
    icon: Lock,
    title: 'The owner sets X (BTK) and Y (ETH)',
    text: 'User A lists an item or service, and chooses the BTK stake X and an ETH stake Y. Both are locked by both sides.',
  },
  {
    icon: Camera,
    title: 'B requests — with a photo — and locks X + Y',
    text: 'User B says what they offer and can attach a photo of it and its condition, so A can decide. B locks X BTK and Y ETH in escrow right away.',
  },
  {
    icon: Lock,
    title: 'A accepts and locks X + Y',
    text: 'Now 2X BTK and 2Y ETH are held by the Escrow contract. Other pending requests are refunded automatically.',
  },
  {
    icon: Handshake,
    title: 'Swap, then both confirm',
    text: 'You swap the goods off-chain, then each press "Confirm exchange done". The moment both have confirmed, each side gets their own Y ETH back. The BTK stays locked until ratings.',
  },
  {
    icon: Star,
    title: 'No dispute: rate each other',
    text: 'Each side rates the other 1–5★. You get your X back, plus 5% of X for every star the other person gave you (a default 5★ if they never rate).',
  },
  {
    icon: Gavel,
    title: 'Dispute: either side can open one',
    text: 'While the trade is in escrow, either person can open a dispute. The admin rules "claimant is right" or "claimant is lying" — see the table below.',
  },
  {
    icon: Ban,
    title: 'Or call it off together',
    text: 'Either side can propose calling the trade off once everything is locked. If the other agrees, everything is refunded — no bonus, no penalty.',
  },
]

const sellBuySteps = (type) => {
  const sell = type === 'sell'
  return [
    {
      icon: Lock,
      title: sell ? 'The seller sets the price Y and the stake X' : 'The buyer sets the offer Y and the stake X',
      text: sell
        ? 'User A lists the item with a photo (required), a price Y in ETH and a BTK stake X.'
        : 'User A lists what they want to buy, with an offer Y in ETH and a BTK stake X.',
    },
    {
      icon: Camera,
      title: sell ? 'The buyer requests and locks X + Y' : 'The seller requests — with a photo — and locks X',
      text: sell
        ? 'User B locks X BTK and the price Y in ETH in escrow when they request.'
        : 'User B (the seller) says what they are selling and can attach a photo of it and its condition. They lock X BTK when they request.',
    },
    {
      icon: Lock,
      title: sell ? 'The seller accepts and locks X' : 'The buyer accepts and locks X + Y',
      text: sell
        ? 'User A locks X BTK. Now 2X BTK and Y ETH are in escrow.'
        : 'User A locks X BTK and the offer Y in ETH. Now 2X BTK and Y ETH are in escrow.',
    },
    {
      icon: Truck,
      title: 'The seller sends the item and marks it shipped',
      text: 'The seller posts or hands over the item, then presses "Mark as shipped" (optionally with a tracking note).',
    },
    {
      icon: PackageCheck,
      title: 'The buyer confirms they received it',
      text: 'Only the buyer confirms. The seller is paid Y ETH straight away; the BTK stays locked until ratings.',
    },
    {
      icon: Star,
      title: 'No dispute: rate each other',
      text: 'You get your X back, plus 5% of X for every star the other person gave you (a default 5★ if they never rate).',
    },
    {
      icon: Gavel,
      title: 'If the buyer never confirms — or the item is wrong — either side can dispute',
      text: 'The buyer can dispute at any time while in escrow ("item never arrived" or "not as described"). The seller can dispute "the buyer never confirmed" once the item is marked as shipped. The admin picks one of three outcomes — see the table below.',
    },
    {
      icon: Ban,
      title: 'Or call it off together',
      text: 'After everything is locked, either side can propose calling the trade off. If the other agrees, everything is refunded — no bonus, no penalty — and the listing stays open.',
    },
  ]
}

function Row({ scenario, a, b, tone }) {
  return (
    <tr className="border-t border-ink-border align-top">
      <td className="py-3 pr-4 text-parchment">{scenario}</td>
      <td className={`py-3 pr-4 font-mono text-xs ${tone?.a ?? ''}`}>{a}</td>
      <td className={`py-3 font-mono text-xs ${tone?.b ?? ''}`}>{b}</td>
    </tr>
  )
}

function Sub({ children }) {
  return <span className="block text-xs text-parchment-faint font-body">{children}</span>
}

const TYPE_TABS = [
  { key: 'barter', label: 'Barter', icon: Repeat },
  { key: 'sell', label: 'Sell', icon: Tag },
  { key: 'buy', label: 'Buy', icon: HandCoins },
]

export default function Rules() {
  const { rules, isLive } = useRules()
  const [type, setType] = useState('barter')
  const [x, setX] = useState('100')
  const [y, setY] = useState('0.5')
  const [starsForA, setStarsForA] = useState(5)
  const [starsForB, setStarsForB] = useState(4)

  const X = Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0
  const Y = Number.isFinite(Number(y)) && Number(y) > 0 ? Number(y) : 0
  const perStar = (X * rules.bonusPercent) / 100
  const fmt = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 4 })
  const bonusA = perStar * starsForA
  const bonusB = perStar * starsForB
  const full = perStar * rules.maxStars
  const missingKeep = (X * (100 - rules.missingPenaltyPercent)) / 100
  const describedKeep = (X * (100 - rules.notAsDescribedPenaltyPercent)) / 100

  const isBarter = type === 'barter'
  const steps = isBarter ? BARTER_STEPS : sellBuySteps(type)
  // On a sell the owner A is the seller; on a buy the owner A is the buyer.
  const seller = type === 'sell' ? 'A' : 'B'
  const buyer = type === 'sell' ? 'B' : 'A'

  return (
    <div className="max-w-4xl mx-auto px-5 sm:px-8 py-10 space-y-10">
      <div>
        <p className="label mb-1">Barter Rules</p>
        <h1 className="font-display font-semibold text-3xl text-parchment">How locking, rewards and penalties work</h1>
        <p className="text-parchment-muted mt-3 max-w-2xl">
          Every trade is protected by two amounts the listing owner chooses: <span className="text-parchment">X</span>, a stake in BTK, and{' '}
          <span className="text-parchment">Y</span>, an amount of ETH — the price on a sale or purchase, and a deposit from each side on a
          barter. A good trade pays a bonus; a fake dispute or a bad product costs you. All of this is enforced by the smart contracts,
          not by the app.
        </p>
        <p className="text-xs text-parchment-faint mt-2">
          {isLive ? 'Live values read from the contract: ' : 'Default values: '}
          bonus {rules.bonusPercent}% of X per star · minimum stake {formatBtk(rules.minimumLockBtk)} · rating window{' '}
          {formatDuration(rules.ratingWindowSeconds)} · missing-item penalty {rules.missingPenaltyPercent}% · not-as-described penalty{' '}
          {rules.notAsDescribedPenaltyPercent}%.
        </p>
      </div>

      <div className="flex items-center gap-2" role="tablist" aria-label="Trade type">
        {TYPE_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={type === key}
            onClick={() => setType(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
              type === key ? 'bg-copper/15 border-copper/40 text-copper' : 'border-ink-border text-parchment-muted hover:text-parchment'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div>
        <h2 className="font-display font-semibold text-xl text-parchment mb-4">What each side locks</h2>
        <div className="card p-5 overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-left">
                <th className="label pb-3 pr-4 font-normal">When</th>
                <th className="label pb-3 pr-4 font-normal">User A (listing owner)</th>
                <th className="label pb-3 font-normal">User B (requester)</th>
              </tr>
            </thead>
            <tbody>
              {isBarter && (
                <>
                  <Row scenario="B requests" a="—" b="X BTK + Y ETH" />
                  <Row scenario="A accepts" a="X BTK + Y ETH" b="(already locked)" />
                </>
              )}
              {type === 'sell' && (
                <>
                  <Row scenario="B (buyer) requests" a="—" b="X BTK + Y ETH (the price)" />
                  <Row scenario="A (seller) accepts" a="X BTK" b="(already locked)" />
                </>
              )}
              {type === 'buy' && (
                <>
                  <Row scenario="B (seller) requests" a="—" b="X BTK" />
                  <Row scenario="A (buyer) accepts" a="X BTK + Y ETH (the offer)" b="(already locked)" />
                </>
              )}
            </tbody>
          </table>
          <p className="text-xs text-parchment-faint mt-3">
            Nothing of yours is locked until you request or accept — and a rejected or cancelled request refunds everything.
          </p>
        </div>
      </div>

      <ol className="space-y-3">
        {steps.map(({ icon: Icon, title, text }, i) => (
          <li key={title} className="card p-5 flex items-start gap-4">
            <span className="grid place-items-center h-9 w-9 shrink-0 rounded-full border border-ledger/30 bg-ledger/10 text-ledger font-mono text-sm font-semibold">
              {i + 1}
            </span>
            <div>
              <h2 className="font-display font-semibold text-parchment flex items-center gap-2">
                <Icon size={16} className="text-parchment-muted" /> {title}
              </h2>
              <p className="text-sm text-parchment-muted mt-1 leading-relaxed">{text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div>
        <h2 className="font-display font-semibold text-xl text-parchment mb-4">Who gets what</h2>
        <div className="card p-5 overflow-x-auto">
          {isBarter ? (
            <>
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left">
                    <th className="label pb-3 pr-4 font-normal">Outcome</th>
                    <th className="label pb-3 pr-4 font-normal">User A (owner)</th>
                    <th className="label pb-3 font-normal">User B (requester)</th>
                  </tr>
                </thead>
                <tbody>
                  <Row
                    scenario={<>Smooth trade — no dispute<Sub>each rated by the other</Sub></>}
                    a={`Y ETH back + X + ${rules.bonusPercent}%·X·(stars B gave A)`}
                    b={`Y ETH back + X + ${rules.bonusPercent}%·X·(stars A gave B)`}
                    tone={{ a: 'text-ledger', b: 'text-ledger' }}
                  />
                  <Row
                    scenario={<>Dispute — the claimant is right<Sub>shown for B; the same with roles swapped if A claims</Sub></>}
                    a="Nothing back — X burned"
                    b={`X + ${rules.bonusPercent}%·X·${rules.maxStars} + ALL the ETH (2Y)`}
                    tone={{ a: 'text-signal-danger', b: 'text-ledger' }}
                  />
                  <Row
                    scenario={<>Dispute — the claimant is lying<Sub>fake dispute by B</Sub></>}
                    a={`Y + X + ${rules.bonusPercent}%·X·${rules.maxStars}`}
                    b="X + Y only — no bonus"
                    tone={{ a: 'text-ledger', b: 'text-signal-warn' }}
                  />
                  <Row scenario={<>Called off together<Sub>both agree</Sub></>} a="Everything back" b="Everything back" />
                </tbody>
              </table>
            </>
          ) : (
            <>
              <table className="w-full text-sm min-w-[620px]">
                <thead>
                  <tr className="text-left">
                    <th className="label pb-3 pr-4 font-normal">Outcome</th>
                    <th className="label pb-3 pr-4 font-normal">Seller (User {seller})</th>
                    <th className="label pb-3 font-normal">Buyer (User {buyer})</th>
                  </tr>
                </thead>
                <tbody>
                  <Row
                    scenario={<>Smooth trade — no dispute<Sub>the buyer confirmed, both rated</Sub></>}
                    a={`Y ETH + X + ${rules.bonusPercent}%·X·(stars buyer gave)`}
                    b={`X + ${rules.bonusPercent}%·X·(stars seller gave)`}
                    tone={{ a: 'text-ledger', b: 'text-ledger' }}
                  />
                  <Row
                    scenario={<>Dispute — seller wins<Sub>the dispute was not true, or the buyer never confirmed</Sub></>}
                    a={`Y ETH + X + ${rules.bonusPercent}%·X·${rules.maxStars}`}
                    b="X only — no bonus"
                    tone={{ a: 'text-ledger', b: 'text-signal-warn' }}
                  />
                  <Row
                    scenario={<>Dispute — product missing<Sub>buyer wins</Sub></>}
                    a={`${100 - rules.missingPenaltyPercent}% of X — ${rules.missingPenaltyPercent}% burned`}
                    b="Y ETH + X back — no bonus"
                    tone={{ a: 'text-signal-danger', b: 'text-ledger' }}
                  />
                  <Row
                    scenario={<>Dispute — not as described<Sub>buyer wins after sending the item back</Sub></>}
                    a={`${100 - rules.notAsDescribedPenaltyPercent}% of X — ${rules.notAsDescribedPenaltyPercent}% burned`}
                    b={`Y ETH + X + ${rules.bonusPercent}%·X·${rules.maxStars}`}
                    tone={{ a: 'text-signal-danger', b: 'text-ledger' }}
                  />
                  <Row scenario={<>Called off together<Sub>both agree</Sub></>} a="Everything back" b="Everything back" />
                </tbody>
              </table>
              <div className="mt-4 text-xs text-parchment-faint space-y-1.5">
                <p className="flex items-start gap-1.5">
                  <Undo2 size={13} className="mt-0.5 shrink-0" />
                  <span>
                    "Not as described": nothing is paid out until the buyer has sent the item back and the seller confirms it (or the admin
                    closes the case). If the buyer never returns it, the case closes as a seller win.
                  </span>
                </p>
                <p>
                  Whoever opens the dispute, the admin picks from the same three outcomes. A dispute bonus is newly minted BTK (it counts
                  as a 5★, not as a rating from the other side); a penalty is burned, not paid to anyone.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      <div>
        <h2 className="font-display font-semibold text-xl text-parchment mb-4">Try the numbers</h2>
        <div className="card p-5 space-y-5">
          <div className="grid sm:grid-cols-4 gap-4">
            <div>
              <label className="label block mb-2" htmlFor="calc-x">Stake X (BTK)</label>
              <input id="calc-x" type="number" min="0" value={x} onChange={(e) => setX(e.target.value)} className="input-field font-mono" />
            </div>
            <div>
              <label className="label block mb-2" htmlFor="calc-y">ETH Y</label>
              <input id="calc-y" type="number" min="0" step="any" value={y} onChange={(e) => setY(e.target.value)} className="input-field font-mono" />
            </div>
            <div>
              <label className="label block mb-2">{isBarter ? 'B rates A' : `Buyer rates seller`}</label>
              <StarRating value={starsForA} onChange={setStarsForA} size={22} label="Stars given to the first side" />
            </div>
            <div>
              <label className="label block mb-2">{isBarter ? 'A rates B' : `Seller rates buyer`}</label>
              <StarRating value={starsForB} onChange={setStarsForB} size={22} label="Stars given to the second side" />
            </div>
          </div>

          {isBarter ? (
            <div className="grid sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg border border-ink-border bg-ink p-4">
                <p className="label mb-1">Smooth trade</p>
                <p className="text-parchment">A gets <span className="font-mono text-ledger">{fmt(X + bonusA)} BTK</span> + {fmt(Y)} ETH</p>
                <p className="text-parchment">B gets <span className="font-mono text-ledger">{fmt(X + bonusB)} BTK</span> + {fmt(Y)} ETH</p>
                <p className="text-xs text-parchment-faint mt-2">{fmt(bonusA + bonusB)} BTK newly minted</p>
              </div>
              <div className="rounded-lg border border-ink-border bg-ink p-4">
                <p className="label mb-1">B right in a dispute</p>
                <p className="text-parchment">A gets <span className="font-mono text-signal-danger">0</span></p>
                <p className="text-parchment">B gets <span className="font-mono text-ledger">{fmt(X + full)} BTK</span> + {fmt(2 * Y)} ETH</p>
                <p className="text-xs text-parchment-faint mt-2 flex items-center gap-1"><Flame size={12} /> {fmt(X)} burned, {fmt(full)} minted</p>
              </div>
              <div className="rounded-lg border border-ink-border bg-ink p-4">
                <p className="label mb-1">B lying in a dispute</p>
                <p className="text-parchment">A gets <span className="font-mono text-ledger">{fmt(X + full)} BTK</span> + {fmt(Y)} ETH</p>
                <p className="text-parchment">B gets <span className="font-mono text-signal-warn">{fmt(X)} BTK</span> + {fmt(Y)} ETH</p>
                <p className="text-xs text-parchment-faint mt-2 flex items-center gap-1"><Coins size={12} /> {fmt(full)} minted for A</p>
              </div>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg border border-ink-border bg-ink p-4">
                <p className="label mb-1">Smooth trade</p>
                <p className="text-parchment">Seller <span className="font-mono text-ledger">{fmt(X + bonusA)} BTK</span> + {fmt(Y)} ETH</p>
                <p className="text-parchment">Buyer <span className="font-mono text-ledger">{fmt(X + bonusB)} BTK</span></p>
                <p className="text-xs text-parchment-faint mt-2">{fmt(bonusA + bonusB)} BTK newly minted</p>
              </div>
              <div className="rounded-lg border border-ink-border bg-ink p-4">
                <p className="label mb-1">Seller wins</p>
                <p className="text-parchment">Seller <span className="font-mono text-ledger">{fmt(X + full)} BTK</span> + {fmt(Y)} ETH</p>
                <p className="text-parchment">Buyer <span className="font-mono text-signal-warn">{fmt(X)} BTK</span></p>
                <p className="text-xs text-parchment-faint mt-2 flex items-center gap-1"><Coins size={12} /> {fmt(full)} minted</p>
              </div>
              <div className="rounded-lg border border-ink-border bg-ink p-4">
                <p className="label mb-1">Product missing</p>
                <p className="text-parchment">Seller <span className="font-mono text-signal-danger">{fmt(missingKeep)} BTK</span></p>
                <p className="text-parchment">Buyer <span className="font-mono text-ledger">{fmt(X)} BTK</span> + {fmt(Y)} ETH</p>
                <p className="text-xs text-parchment-faint mt-2 flex items-center gap-1"><Flame size={12} /> {fmt(X - missingKeep)} burned</p>
              </div>
              <div className="rounded-lg border border-ink-border bg-ink p-4">
                <p className="label mb-1">Not as described</p>
                <p className="text-parchment">Seller <span className="font-mono text-signal-danger">{fmt(describedKeep)} BTK</span></p>
                <p className="text-parchment">Buyer <span className="font-mono text-ledger">{fmt(X + full)} BTK</span> + {fmt(Y)} ETH</p>
                <p className="text-xs text-parchment-faint mt-2 flex items-center gap-1"><Flame size={12} /> {fmt(X - describedKeep)} burned, {fmt(full)} minted</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card p-5 space-y-2 text-sm text-parchment-muted">
        <h2 className="font-display font-semibold text-parchment flex items-center gap-2"><Clock size={16} /> The fine print</h2>
        <ul className="list-disc list-inside space-y-1.5 leading-relaxed">
          <li>
            <span className="text-parchment">Rating window:</span> after the exchange is confirmed, you have {formatDuration(rules.ratingWindowSeconds)} to rate.
            Anyone who doesn't rate in time counts as giving the other side a 5★, and anyone can then finalise the trade to release the stakes.
          </li>
          <li>
            <span className="text-parchment">Ratings are private:</span> the app never shows you the stars others gave you — only the ones
            you gave. Other traders can see an average when they decide whether to trade with you. (The blockchain itself is public, so a
            technical user could still read the raw events.)
          </li>
          <li>
            <span className="text-parchment">Photos:</span> a sell listing needs a photo, and a requester can attach one of what they offer.
            Only the photo's fingerprint is written on-chain; the file is stored by the backend and checked against that fingerprint.
          </li>
          <li>
            <span className="text-parchment">Disputes</span> can only be opened while a trade is in escrow — before the exchange is confirmed.
            Every dispute stays on record in the admin's history.
          </li>
          <li>
            <span className="text-parchment">The admin</span> is a single trusted wallet in this prototype. It only rules on disputes: it
            cannot list or trade, and has no reputation. Its rulings are on-chain and final.
          </li>
          <li><span className="text-parchment">Rejected or cancelled</span> requests return the requester's stake and ETH in full.</li>
        </ul>
        <div className="pt-2">
          <Link to="/marketplace" className="inline-flex items-center gap-1.5 text-copper hover:text-copper-400">
            Browse the marketplace <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  )
}
