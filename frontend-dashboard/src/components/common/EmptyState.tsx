export default function EmptyState({ message = 'No data found.' }: { message?: string }) {
  return <p style={{ padding: 16, opacity: 0.6 }}>{message}</p>
}