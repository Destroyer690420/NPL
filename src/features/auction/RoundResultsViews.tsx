import { CheckCircle2, Crown, ShieldAlert, Trophy, Users, XCircle } from 'lucide-react'
import type { PlayerDoc, RoundSnapshot, TeamDoc } from '@shared/types'
import { evaluateTeamQualification, rankQualifiedTeams } from '@shared/rounds'
import { currency, points as formatPoints } from '@/lib/format'

function RoleCountsPills({
  bat,
  bowl,
  ar,
  wk,
}: {
  bat: number
  bowl: number
  ar: number
  wk: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
      <span className="rounded-md bg-white/10 px-2 py-0.5 text-white/90">BAT {bat}</span>
      <span className="rounded-md bg-white/10 px-2 py-0.5 text-white/90">BOWL {bowl}</span>
      <span className="rounded-md bg-white/10 px-2 py-0.5 text-white/90">AR {ar}</span>
      <span className="rounded-md bg-white/10 px-2 py-0.5 text-white/90">WK {wk}</span>
    </div>
  )
}

export function Round1ResultsStage({
  snapshot,
  eventName,
}: {
  snapshot: RoundSnapshot | null | undefined
  eventName: string
}) {
  const results = snapshot?.results ?? []
  const eliminated = results.filter((r) => !r.qualified)
  const qualified = results.filter((r) => r.qualified)

  return (
    <div className="relative z-10 flex h-full min-h-[inherit] w-full flex-col justify-between px-6 py-5 sm:px-10 sm:py-7 overflow-y-auto">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex flex-col leading-none">
          <span className="font-['Outfit',sans-serif] text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white">
            NPL <span className="text-[#f5eb3b]">2026</span>
          </span>
          <span className="mt-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.24em] text-white/75">
            ROUND 1 RESULTS · QUALIFICATION SUMMARY
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-950/70 px-4 py-1.5 text-xs sm:text-sm font-black uppercase tracking-wider text-emerald-300">
            <CheckCircle2 className="size-4" aria-hidden />
            {qualified.length} Qualified
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-rose-400/50 bg-rose-950/70 px-4 py-1.5 text-xs sm:text-sm font-black uppercase tracking-wider text-rose-300">
            <XCircle className="size-4" aria-hidden />
            {eliminated.length} Eliminated
          </div>
          <p className="hidden md:block font-['Outfit',sans-serif] text-lg font-black uppercase tracking-wide text-white ml-2">
            {eventName}
          </p>
        </div>
      </header>

      {/* Main Content */}
      <div className="my-5 grid flex-1 gap-6 lg:grid-cols-12 items-start">
        {/* Eliminated Teams — Prominent Display */}
        <section className="lg:col-span-7 rounded-3xl border-2 border-rose-500/45 bg-gradient-to-b from-[#2b070c]/90 via-[#160407]/92 to-black/95 p-5 sm:p-6 shadow-[0_20px_50px_rgba(0,0,0,0.75)] backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 border-b border-rose-500/25 pb-3">
            <div className="flex items-center gap-2.5">
              <ShieldAlert className="size-6 text-rose-400" aria-hidden />
              <div>
                <h1 className="font-['Outfit',sans-serif] text-xl sm:text-2xl font-black uppercase tracking-wide text-white">
                  Eliminated Teams
                </h1>
                <p className="text-xs text-rose-200/80">
                  Failed minimum squad rule (11+ Players · 3+ BAT · 3+ BOWL · 1+ AR · 1+ WK)
                </p>
              </div>
            </div>
            <span className="rounded-full bg-rose-500/20 px-3 py-1 font-['Outfit',sans-serif] text-sm font-black text-rose-300 tabular-nums">
              {eliminated.length}
            </span>
          </div>

          {eliminated.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto size-10 text-emerald-400" aria-hidden />
              <p className="mt-2 font-['Outfit',sans-serif] text-lg font-bold text-white">
                Zero Eliminations!
              </p>
              <p className="text-xs text-white/70">Every participating team met the Round 1 qualification criteria.</p>
            </div>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {eliminated.map((team) => (
                <li
                  key={team.teamId}
                  className="rounded-2xl border border-rose-500/35 bg-black/65 p-3.5 shadow-lg"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-['Outfit',sans-serif] text-base sm:text-lg font-black text-white truncate">
                      {team.teamName}
                    </h2>
                    <span className="shrink-0 rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-black text-rose-300 tabular-nums">
                      {team.playerCount} / 11
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs font-bold text-rose-300">
                    {team.missingSummary}
                  </p>
                  <div className="mt-2.5">
                    <RoleCountsPills
                      bat={team.batCount}
                      bowl={team.bowlCount}
                      ar={team.arCount}
                      wk={team.wkCount}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Qualified Teams Advancing to Round 2 */}
        <section className="lg:col-span-5 rounded-3xl border border-[#f5eb3b]/40 bg-gradient-to-b from-[#1d1906]/85 via-[#100e04]/90 to-black/95 p-5 sm:p-6 shadow-[0_20px_50px_rgba(0,0,0,0.75)] backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 border-b border-[#f5eb3b]/20 pb-3">
            <div className="flex items-center gap-2.5">
              <Users className="size-6 text-[#f5eb3b]" aria-hidden />
              <div>
                <h2 className="font-['Outfit',sans-serif] text-xl sm:text-2xl font-black uppercase tracking-wide text-white">
                  Advancing to Round 2
                </h2>
                <p className="text-xs text-amber-200/75">
                  Qualified teams eligible for the Round 2 auction
                </p>
              </div>
            </div>
            <span className="rounded-full bg-[#f5eb3b]/20 px-3 py-1 font-['Outfit',sans-serif] text-sm font-black text-[#f5eb3b] tabular-nums">
              {qualified.length}
            </span>
          </div>

          {qualified.length === 0 ? (
            <p className="py-10 text-center text-sm text-white/70">
              No teams met the Round 1 qualification criteria.
            </p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {qualified.map((team, idx) => (
                <li
                  key={team.teamId}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-400/25 bg-black/60 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-['Outfit',sans-serif] text-xs font-black text-emerald-400 tabular-nums">
                        #{idx + 1}
                      </span>
                      <span className="truncate font-['Outfit',sans-serif] text-sm sm:text-base font-bold text-white">
                        {team.teamName}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-white/65">
                      {team.playerCount} players · BAT {team.batCount} · BOWL {team.bowlCount} · AR {team.arCount} · WK {team.wkCount}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="font-['Outfit',sans-serif] text-sm font-black text-[#f5eb3b] tabular-nums">
                      {formatPoints(team.totalPoints)} pts
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="border-t border-white/10 pt-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
        Qualified teams will start Round 2 with ₹125 Crore purse and fresh squads
      </footer>
    </div>
  )
}

export function Round2FinalResultsStage({
  snapshot,
  eventName,
  currencyLabel = '₹',
}: {
  snapshot: RoundSnapshot | null | undefined
  eventName: string
  currencyLabel?: string
}) {
  const results = snapshot?.results ?? []
  const qualified = rankQualifiedTeams(results)
  const disqualified = results.filter((r) => !r.qualified)
  const winner = qualified[0] ?? null

  return (
    <div className="relative z-10 flex h-full min-h-[inherit] w-full flex-col justify-between px-6 py-5 sm:px-10 sm:py-7 overflow-y-auto">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex flex-col leading-none">
          <span className="font-['Outfit',sans-serif] text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white">
            NPL <span className="text-[#f5eb3b]">2026</span>
          </span>
          <span className="mt-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.24em] text-white/75">
            ROUND 2 FINAL RESULTS · CHAMPIONSHIP LEADERBOARD
          </span>
        </div>

        <p className="font-['Outfit',sans-serif] text-base sm:text-xl lg:text-2xl font-black uppercase tracking-wide text-white">
          {eventName}
        </p>
      </header>

      <div className="my-5 space-y-6 flex-1">
        {/* NPL Winner Hero Showcase */}
        {winner ? (
          <section className="relative overflow-hidden rounded-3xl border-2 border-[#f5eb3b] bg-gradient-to-r from-[#2c2505]/95 via-[#1a1503]/95 to-black/95 p-6 sm:p-7 shadow-[0_0_60px_rgba(245,235,59,0.28)]">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="flex items-center gap-4 sm:gap-5">
                <div className="flex size-16 sm:size-20 items-center justify-center rounded-2xl border-2 border-[#f5eb3b] bg-[#f5eb3b]/15 shadow-[0_0_25px_rgba(245,235,59,0.4)]">
                  <Crown className="size-9 sm:size-11 text-[#f5eb3b]" aria-hidden />
                </div>
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-[#f5eb3b] px-3.5 py-1 font-['Outfit',sans-serif] text-xs font-black uppercase tracking-[0.2em] text-black">
                    <Trophy className="size-3.5" aria-hidden />
                    NPL WINNER · #1 RANKED
                  </div>
                  <h1 className="mt-2 font-['Outfit',sans-serif] text-3xl sm:text-5xl font-black uppercase tracking-tight text-white">
                    {winner.teamName}
                  </h1>
                  <div className="mt-2">
                    <RoleCountsPills
                      bat={winner.batCount}
                      bowl={winner.bowlCount}
                      ar={winner.arCount}
                      wk={winner.wkCount}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6 sm:gap-8">
                <div className="text-left sm:text-right">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/65">
                    Total Squad Points
                  </p>
                  <p className="font-['Outfit',sans-serif] text-4xl sm:text-5xl font-black text-[#f5eb3b] tabular-nums">
                    {formatPoints(winner.totalPoints)}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/65">
                    Remaining Purse
                  </p>
                  <p className="font-['Outfit',sans-serif] text-2xl sm:text-3xl font-black text-emerald-400 tabular-nums">
                    {currency(winner.remainingPurse, currencyLabel)}
                  </p>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {/* Qualified Teams Leaderboard */}
        <section className="rounded-3xl border border-white/15 bg-black/70 p-5 sm:p-6 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
            <h2 className="font-['Outfit',sans-serif] text-lg sm:text-xl font-black uppercase tracking-wide text-white">
              Qualified Teams Leaderboard ({qualified.length})
            </h2>
            <span className="text-xs font-semibold text-white/65">
              Ranked by Total Points (Tie-breaker: Remaining Purse)
            </span>
          </div>

          {qualified.length === 0 ? (
            <p className="py-8 text-center text-sm text-white/70">
              No Round 2 teams met the qualification criteria.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-[11px] font-bold uppercase tracking-wider text-white/60">
                    <th className="py-2.5 pr-3">Rank</th>
                    <th className="py-2.5 px-3">Team</th>
                    <th className="py-2.5 px-3 text-center">Squad</th>
                    <th className="py-2.5 px-3">Composition</th>
                    <th className="py-2.5 px-3 text-right">Remaining Purse</th>
                    <th className="py-2.5 pl-3 text-right">Total Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {qualified.map((team, idx) => {
                    const isFirst = idx === 0
                    return (
                      <tr
                        key={team.teamId}
                        className={isFirst ? 'bg-[#f5eb3b]/10' : 'hover:bg-white/5'}
                      >
                        <td className="py-3 pr-3 font-['Outfit',sans-serif] text-base font-black tabular-nums text-[#f5eb3b]">
                          #{idx + 1}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className="font-['Outfit',sans-serif] text-base font-extrabold text-white">
                              {team.teamName}
                            </span>
                            {isFirst ? (
                              <span className="rounded-full bg-[#f5eb3b] px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-black">
                                Winner
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center font-bold tabular-nums text-white/90">
                          {team.playerCount}
                        </td>
                        <td className="py-3 px-3">
                          <RoleCountsPills
                            bat={team.batCount}
                            bowl={team.bowlCount}
                            ar={team.arCount}
                            wk={team.wkCount}
                          />
                        </td>
                        <td className="py-3 px-3 text-right font-bold tabular-nums text-emerald-400">
                          {currency(team.remainingPurse, currencyLabel)}
                        </td>
                        <td className="py-3 pl-3 text-right font-['Outfit',sans-serif] text-lg font-black tabular-nums text-[#f5eb3b]">
                          {formatPoints(team.totalPoints)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Disqualified Round 2 Teams */}
        {disqualified.length > 0 ? (
          <section className="rounded-3xl border border-rose-500/40 bg-gradient-to-b from-[#2b070c]/85 to-black/95 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3 border-b border-rose-500/25 pb-3">
              <div className="flex items-center gap-2">
                <XCircle className="size-5 text-rose-400" aria-hidden />
                <h2 className="font-['Outfit',sans-serif] text-lg font-black uppercase tracking-wide text-white">
                  Disqualified Teams ({disqualified.length})
                </h2>
              </div>
              <span className="text-xs text-rose-200/75">
                Did not satisfy Round 2 squad &amp; role minimums
              </span>
            </div>

            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {disqualified.map((team) => (
                <li
                  key={team.teamId}
                  className="rounded-2xl border border-rose-500/35 bg-black/65 p-3.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-['Outfit',sans-serif] text-base font-black text-white truncate">
                      {team.teamName}
                    </span>
                    <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 text-[11px] font-black text-rose-300 tabular-nums">
                      {team.playerCount} / 11
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs font-bold text-rose-300">{team.missingSummary}</p>
                  <div className="mt-2">
                    <RoleCountsPills
                      bat={team.batCount}
                      bowl={team.bowlCount}
                      ar={team.arCount}
                      wk={team.wkCount}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  )
}

export function LiveStandingsStage({
  teams,
  players,
  eliminatedTeamIds = [],
  currentRound = 0,
  eventName,
  currencyLabel = '₹',
}: {
  teams: readonly TeamDoc[]
  players: readonly PlayerDoc[]
  eliminatedTeamIds?: readonly string[]
  currentRound?: 0 | 1 | 2
  eventName: string
  currencyLabel?: string
}) {
  const eliminatedSet = new Set(eliminatedTeamIds)
  const squadByTeam = new Map<string, PlayerDoc[]>()
  for (const player of players) {
    if (player.status === 'sold' && player.soldToTeamId) {
      const list = squadByTeam.get(player.soldToTeamId) ?? []
      list.push(player)
      squadByTeam.set(player.soldToTeamId, list)
    }
  }

  const rows = teams
    .filter((t) => !(currentRound === 2 && eliminatedSet.has(t.id)))
    .map((team) => ({
      ...evaluateTeamQualification(team, squadByTeam.get(team.id) ?? []),
      eliminated: eliminatedSet.has(team.id),
    }))
    .sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
      if (b.remainingPurse !== a.remainingPurse) return b.remainingPurse - a.remainingPurse
      return a.teamName.localeCompare(b.teamName)
    })

  return (
    <div className="relative z-10 flex h-full min-h-[inherit] w-full flex-col justify-between px-6 py-5 sm:px-10 sm:py-7 overflow-y-auto">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex flex-col leading-none">
          <span className="font-['Outfit',sans-serif] text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white">
            NPL <span className="text-[#f5eb3b]">2026</span>
          </span>
          <span className="mt-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.24em] text-white/75">
            LIVE TEAM STANDINGS &amp; SQUAD TRACKER
          </span>
        </div>
        <p className="font-['Outfit',sans-serif] text-base sm:text-xl lg:text-2xl font-black uppercase tracking-wide text-white">
          {eventName}
        </p>
      </header>

      <div className="my-5 flex-1">
        <div className="rounded-3xl border border-white/15 bg-black/70 p-5 sm:p-6 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h1 className="font-['Outfit',sans-serif] text-xl sm:text-2xl font-black uppercase tracking-wide text-white">
              {currentRound > 0 ? `Round ${currentRound} Standings` : 'Team Standings'} ({rows.length})
            </h1>
            <span className="text-xs font-semibold text-white/65">
              Min Rule: 11 Players (3 BAT · 3 BOWL · 1 AR · 1 WK)
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] font-bold uppercase tracking-wider text-white/60">
                  <th className="py-2.5 pr-3">#</th>
                  <th className="py-2.5 px-3">Team</th>
                  <th className="py-2.5 px-3 text-center">Squad</th>
                  <th className="py-2.5 px-3">Composition</th>
                  <th className="py-2.5 px-3">Qualification</th>
                  <th className="py-2.5 px-3 text-right">Purse Left</th>
                  <th className="py-2.5 pl-3 text-right">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {rows.map((team, idx) => (
                  <tr key={team.teamId} className="hover:bg-white/5">
                    <td className="py-2.5 pr-3 font-['Outfit',sans-serif] text-sm font-black text-[#f5eb3b] tabular-nums">
                      #{idx + 1}
                    </td>
                    <td className="py-2.5 px-3 font-['Outfit',sans-serif] text-base font-bold text-white">
                      {team.teamName}
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold tabular-nums text-white/90">
                      {team.playerCount}
                    </td>
                    <td className="py-2.5 px-3">
                      <RoleCountsPills
                        bat={team.batCount}
                        bowl={team.bowlCount}
                        ar={team.arCount}
                        wk={team.wkCount}
                      />
                    </td>
                    <td className="py-2.5 px-3 text-xs font-bold">
                      {team.qualified ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-emerald-300">
                          <CheckCircle2 className="size-3.5" aria-hidden />
                          Qualified
                        </span>
                      ) : (
                        <span className="text-amber-300">{team.missingSummary}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold tabular-nums text-emerald-400">
                      {currency(team.remainingPurse, currencyLabel)}
                    </td>
                    <td className="py-2.5 pl-3 text-right font-['Outfit',sans-serif] text-base font-black tabular-nums text-[#f5eb3b]">
                      {formatPoints(team.totalPoints)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

