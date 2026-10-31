/*
 * API tokens (spec 4.2). People manage their own tokens; admins manage the tokens of bots (and of the default bot,
 * where the UI warns that they carry admin rights). The plain text is shown once, when the token is created; creating
 * one works only from the session of the interface, never with a token.
 */

import type { Token, TokenAbility } from '@/types';
import type { Page } from './client';
import { del, getPage, post } from './http';

export function listTokens(user_id: string): Promise<Page<Token>> {
  return getPage<Token>('/tokens', { user_id });
}

export interface CreateTokenInput {
  user_id: string;
  name: string;
  abilities: TokenAbility[];
  expires_at?: string | null;
}

/** Creates a token and answers it together with its plain text, which cannot be read again. */
export function createToken(input: CreateTokenInput): Promise<{ token: Token; plain_text: string }> {
  return post<{ token: Token; plain_text: string }>('/tokens', input);
}

export function revokeToken(id: string): Promise<void> {
  return del<void>(`/tokens/${id}`);
}
