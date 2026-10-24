// One way to jump from anywhere to a suggestion in the action queue (spec 006 FR-028).
export function QueueLink({ id, onShow }: { id: string | null | undefined; onShow: (id: string) => void }) {
  if (!id) return null
  return (
    <button className="link queue-link" onClick={() => onShow(id)}>
      Show in queue
    </button>
  )
}
