interface Props {
  message: string
  onRetry?: () => void
}

export default function ErrorState({ message, onRetry }: Props) {
  return (
    <div role="alert" style={{ padding: 16, color: '#dc2626' }}>
      <p style={{ margin: 0 }}>Something went wrong: {message}</p>
      {onRetry && (
        <button onClick={onRetry} style={{ marginTop: 8 }}>
          Retry
        </button>
      )}
    </div>
  )
}