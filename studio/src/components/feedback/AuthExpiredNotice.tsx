import { Banner } from "@xorkavi/arcade-gen";

export function AuthExpiredNotice() {
  return (
    <Banner intent="warning">
      <div>
        <strong>Your AWS session looks expired</strong>
        <div style={{ opacity: 0.9 }}>
          Run <code>aws sso login --profile dev</code> in a terminal, then try again.
        </div>
      </div>
    </Banner>
  );
}
