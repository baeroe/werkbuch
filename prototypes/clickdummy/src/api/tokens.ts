/*
 * API tokens (spec 4.2). People manage their own tokens; admins manage the tokens of bots (and of the default bot,
 * where the UI warns that they carry admin rights). The plain text is shown once, when the token is created.
 */

import type { Token, TokenAbility, User } from '@/types';
import { isOrgAdmin } from './access';
import { FieldErrors, forbidden, newId, notFound, paginate, read, write, type Page } from './client';
import type { Db } from './db';

const ABILITIES: readonly TokenAbility[] = ['read', 'write', 'mcp'];

/** May the account manage the tokens of `owner`? Their own, or a bot's for an admin. */
function mayManage(me: User, owner: User): boolean {
  return me.id === owner.id || (isOrgAdmin(me) && owner.type === 'bot');
}

function requireOwner(db: Db, me: User, userId: string): User {
  const owner = db.users.find((user) => user.id === userId);
  if (!owner) throw notFound('Das Konto');
  if (!mayManage(me, owner)) throw forbidden('Tokens verwaltest du für dich selbst; Admins verwalten die Tokens von Bots.');
  return owner;
}

export function listTokens(user_id: string): Promise<Page<Token>> {
  return read(({ db, me }) => {
    requireOwner(db, me, user_id);
    return paginate(db.tokens.filter((token) => token.user_id === user_id));
  });
}

export interface CreateTokenInput {
  user_id: string;
  name: string;
  abilities: TokenAbility[];
  expires_at?: string | null;
}

/** Creates a token and answers it together with its plain text, which cannot be read again. */
export function createToken(input: CreateTokenInput): Promise<{ token: Token; plain_text: string }> {
  return write(({ db, me, stamp }) => {
    const owner = requireOwner(db, me, input.user_id);
    if (owner.disabled_at !== null) throw forbidden('Für ein deaktiviertes Konto lassen sich keine Tokens anlegen.');
    const errors = new FieldErrors();
    if (input.name.trim() === '') errors.add('name', 'Der Name darf nicht leer sein.');
    if (input.abilities.length === 0 || !input.abilities.every((ability) => ABILITIES.includes(ability))) errors.add('abilities', 'Wähle mindestens eine Fähigkeit.');
    if (input.expires_at && (Number.isNaN(Date.parse(input.expires_at)) || input.expires_at <= stamp)) errors.add('expires_at', 'Das Ablaufdatum muss in der Zukunft liegen.');
    errors.throwIfAny();

    const token: Token = {
      id: newId('tok'),
      user_id: owner.id,
      name: input.name.trim(),
      abilities: [...new Set(input.abilities)],
      expires_at: input.expires_at ?? null,
      last_used_at: null,
      created_at: stamp,
    };
    db.tokens.push(token);
    const random = Array.from({ length: 40 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    return { token, plain_text: `wb_${random}` };
  });
}

export function revokeToken(id: string): Promise<void> {
  return write(({ db, me }) => {
    const token = db.tokens.find((entry) => entry.id === id);
    if (!token) throw notFound('Der Token');
    requireOwner(db, me, token.user_id);
    db.tokens = db.tokens.filter((entry) => entry.id !== id);
  });
}
