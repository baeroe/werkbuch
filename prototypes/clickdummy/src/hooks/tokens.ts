import { useQuery } from '@tanstack/react-query';
import { createToken, listTokens, revokeToken } from '@/api/tokens';
import { qk } from './keys';
import { useApiMutation } from './mutation';

export function useTokens(userId: string | null | undefined) {
  return useQuery({ queryKey: qk.tokens.list({ user_id: userId }), queryFn: () => listTokens(userId!), enabled: !!userId });
}

/** Answers `{ token, plain_text }`; the plain text is shown once, and the answer leaves the cache with its dialog. */
export function useCreateToken() {
  return useApiMutation(createToken, [qk.tokens.all], { gcTime: 0 });
}

export function useRevokeToken() {
  return useApiMutation(revokeToken, [qk.tokens.all]);
}
