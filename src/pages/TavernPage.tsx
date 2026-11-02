import { Sheet } from '../components/ui';
import { activityText } from '../components/board/BoardExtras';
import { ChatPanel, useChat, writeSeen } from '../components/tavern/Chat';
import { useActivity } from '../lib/queries';
import { ago } from '../lib/format';

export default function TavernPage() {
  const chat = useChat();
  const activity = useActivity(20).data ?? [];

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_20rem]">
      <Sheet className="flex flex-col !p-0">
        <header className="border-b-2 border-double border-ink/25 px-5 pb-3 pt-5 sm:px-6">
          <h1 className="font-display text-3xl text-ink">The Tavern</h1>
          <p className="text-ink-soft">Brag, plot, and trash-talk your rivals. Keep it fun: no slurs, nothing personal. Admins can delete messages and mute.</p>
        </header>
        <ChatPanel chat={chat} heightClass="h-[60vh] min-h-[22rem]" onSeen={writeSeen} />
      </Sheet>

      <aside>
        <Sheet className="!p-5">
          <h2 className="font-display text-2xl text-ink">Town crier</h2>
          <p className="text-sm text-ink-soft">Latest from the board</p>
          {activity.length === 0 ? <p className="mt-3 text-ink-soft">Nothing yet. The first approved claim will be announced here.</p> : (
            <ol className="mt-3 space-y-2.5 text-sm">
              {activity.map((a, i) => (
                <li key={`${a.at}-${i}`} className="border-b border-ink/10 pb-2 last:border-0">
                  <p>{activityText(a)}</p>
                  <p className="text-xs text-ink-soft">{ago(a.at)}</p>
                </li>
              ))}
            </ol>
          )}
        </Sheet>
      </aside>
    </div>
  );
}
