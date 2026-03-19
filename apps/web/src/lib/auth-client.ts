"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient, adminClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [magicLinkClient(), adminClient()],
});

export const { signIn, signOut, useSession } = authClient;
