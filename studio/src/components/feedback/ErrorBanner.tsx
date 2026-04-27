import { Banner } from "@xorkavi/arcade-gen";

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Banner
      intent="alert"
      action={onRetry ? { label: "Try again", onClick: onRetry } : undefined}
    >
      <div>
        <strong>Something went wrong</strong>
        <div style={{ opacity: 0.9 }}>{message}</div>
      </div>
    </Banner>
  );
}
