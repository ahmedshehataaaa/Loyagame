/* Empty states name real McDonald's menu items — the same ones the game
   actually throws (engine/config.js FOODS / WHEEL prizes) — so an operator
   seeing a blank panel still reads it as "this campaign, no data yet" rather
   than "this dashboard is broken". Single-tenant on purpose; see ADR 0017. */
export function Empty({ icon = '🍟', title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <div aria-hidden="true" className="text-3xl leading-none opacity-70">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="text-subtle-foreground max-w-sm text-xs">{hint}</p> : null}
    </div>
  );
}

export const EMPTY_COPY = {
  plays: {
    icon: '🍟',
    title: 'No rounds sliced yet',
    hint: 'The fries are still in the fryer — as soon as a player finishes a 30-second round it lands here.',
  },
  players: {
    icon: '🍔',
    title: 'No players yet',
    hint: 'Nobody has picked up a knife. Players appear the first time they start a round.',
  },
  redemptions: {
    icon: '🍦',
    title: 'No prizes won yet',
    hint: 'Free Fries, a McFlurry® and a Big Mac® are all on the wheel — a win shows up here the moment the server mints its code.',
  },
  fraud: {
    icon: '🥔',
    title: 'Nothing flagged',
    hint: 'No run has tripped the score, duration or token-replay checks. A clean board is the expected state.',
  },
  engagement: {
    icon: '🍗',
    title: 'Not enough plays to chart',
    hint: 'Once rounds start landing, plays-per-day and peak hours fill in here.',
  },
};
