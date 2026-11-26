import { Award, CheckCircle2, Crown, ShieldAlert, Sparkles, Trophy, Users } from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'

export function TeamRulesView() {
  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Header Banner */}
      <div className="rounded-2xl border border-line-strong bg-gradient-to-br from-[#181c26] via-[#12151f] to-[#1a150e] p-5 sm:p-6 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="h-4 w-1 rounded-full bg-accent shadow-[0_0_8px_rgba(245,175,25,0.6)]" aria-hidden />
          <p className="text-[11px] font-bold uppercase tracking-wider text-accent-light">
            Tournament Handbook
          </p>
        </div>
        <h1 className="mt-1 font-['Outfit',sans-serif] text-2xl sm:text-3xl font-black text-white">
          Official Auction &amp; Scoring Rules
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-ink-muted">
          Review the round progression, mandatory squad composition, elimination criteria, and Round 2 Captain multipliers.
        </p>
      </div>

      {/* 1. Round Progression Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-accent" aria-hidden />
            1. Two-Round Auction Structure
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-3 text-sm text-ink-soft">
          <div className="rounded-xl border border-line bg-surface-muted/40 p-4">
            <p className="font-bold text-white">Round 1 — Qualification Auction (187 Players)</p>
            <p className="mt-1 text-xs text-ink-muted leading-relaxed">
              All participating teams bid from the Round 1 pool of 187 players presented in role order:{' '}
              <span className="font-semibold text-white">Batsmen → Bowlers → All-Rounders → Wicket-Keepers</span>.
              Teams that fail to satisfy every qualification rule at the end of Round 1 are eliminated.
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface-muted/40 p-4">
            <p className="font-bold text-white">Round 2 — Championship Final Auction (132 Players)</p>
            <p className="mt-1 text-xs text-ink-muted leading-relaxed">
              Only qualified teams advance to Round 2. Every qualified team starts Round 2 with a fresh{' '}
              <span className="font-semibold text-accent">₹125 Crore</span> purse and clean squad, bidding across
              a 132-player elite pool generated from the master player list.
            </p>
          </div>
        </CardBody>
      </Card>

      {/* 2. Qualification & Elimination Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-rose-400" aria-hidden />
            2. Squad Qualification &amp; Elimination Rules
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4 text-sm text-ink-soft">
          <p className="text-xs sm:text-sm text-ink-muted leading-relaxed">
            Applies at the end of <strong className="text-white">both Round 1 and Round 2</strong>. A team qualifies
            if and only if it satisfies <strong className="text-white">all five</strong> requirements below:
          </p>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {[
              { label: 'Total Players', min: '11+' },
              { label: 'Batsmen (BAT)', min: '3+' },
              { label: 'Bowlers (BOWL)', min: '3+' },
              { label: 'All-Rounders (AR)', min: '1+' },
              { label: 'Wicket-Keepers (WK)', min: '1+' },
            ].map((req) => (
              <div
                key={req.label}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-center"
              >
                <p className="font-['Outfit',sans-serif] text-2xl font-black text-emerald-300 tabular-nums">
                  {req.min}
                </p>
                <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-white/90">
                  {req.label}
                </p>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3.5 text-xs text-rose-200">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-rose-400" aria-hidden />
            <p className="leading-relaxed">
              <strong className="text-rose-100">Elimination / Disqualification:</strong> Any team missing one or more
              minimum role/player counts in Round 1 is eliminated and locked out of Round 2. In Round 2, any team failing
              these minimums is marked Disqualified on the final leaderboard.
            </p>
          </div>
        </CardBody>
      </Card>

      {/* 3. Captain & Star Player Multiplier Rules */}
      <Card className="border-accent/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="size-4 text-accent" aria-hidden />
            3. Captain &amp; Star Player Rules
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4 text-sm text-ink-soft">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-amber-400/35 bg-amber-500/10 p-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-accent">
                  <Crown className="size-4" aria-hidden />
                  Regular Captain
                </span>
                <span className="rounded-full bg-accent px-2.5 py-0.5 font-['Outfit',sans-serif] text-xs font-black text-black">
                  2× Points
                </span>
              </div>
              <p className="mt-2 text-xs text-ink-muted leading-relaxed">
                Appointing a standard squad player as your Captain{' '}
                <strong className="text-white">doubles (2×)</strong> that player&apos;s points.
              </p>
              <p className="mt-2 rounded-lg bg-black/40 px-3 py-1.5 font-mono text-xs text-amber-200">
                Example: 9 pts → 18 pts
              </p>
            </div>

            <div className="rounded-xl border border-amber-300/60 bg-gradient-to-br from-amber-500/20 to-yellow-500/10 p-4 shadow-[0_0_25px_rgba(245,175,25,0.12)]">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-amber-200">
                  <Sparkles className="size-4 text-amber-300" aria-hidden />
                  Star Player Captain
                </span>
                <span className="rounded-full bg-[#f5eb3b] px-2.5 py-0.5 font-['Outfit',sans-serif] text-xs font-black text-black">
                  2.5× Points
                </span>
              </div>
              <p className="mt-2 text-xs text-ink-muted leading-relaxed">
                Appointing a <strong className="text-amber-200">★ Star Player</strong> as your Captain multiplies
                that player&apos;s points by <strong className="text-white">2.5×</strong>.
              </p>
              <p className="mt-2 rounded-lg bg-black/40 px-3 py-1.5 font-mono text-xs text-[#f5eb3b]">
                Example: 9 pts (★ Star) → 22.5 pts
              </p>
            </div>
          </div>

          <ul className="space-y-2 rounded-xl border border-line bg-surface-muted/40 p-4 text-xs text-ink-muted leading-relaxed">
            <li className="flex items-start gap-2">
              <Award className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
              <span>
                <strong className="text-white">How to choose:</strong> Near the end of Round 2, once the Admin unlocks the{' '}
                <strong className="text-white">Choose Captain</strong> option, eligible Round 2 teams can tap any squad
                player&apos;s photo on their <strong className="text-white">Home</strong> page to appoint them Captain.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Award className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
              <span>
                <strong className="text-white">Captain-only boost:</strong> Only your selected Captain&apos;s points
                multiply (2× or 2.5×). All other players in your squad keep their standard base points.
              </span>
            </li>
          </ul>
        </CardBody>
      </Card>

      {/* 4. Winner & Tie-Breaker */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="size-4 text-accent" aria-hidden />
            4. Final Standings &amp; Winner Determination
          </CardTitle>
        </CardHeader>
        <CardBody className="text-xs sm:text-sm text-ink-muted leading-relaxed">
          All qualified Round 2 teams are ranked from <strong className="text-white">highest total squad points</strong>{' '}
          (base points + Captain multiplier bonus) to lowest. If two qualified teams finish tied on total points, the team
          with the higher <strong className="text-emerald-300">remaining purse</strong> ranks ahead.
        </CardBody>
      </Card>
    </div>
  )
}
