// team hub, issue 47 item 6: the sign-up list's refusal, in plain words.
//
// The database refuses an email that is not on the hub's list (issue 40 item
// 11), but Supabase's auth service hands the screens a server error (500)
// with its own words, "Database error saving new user" on the first user
// form and "Database error creating new user" when the administrator invites
// someone, not the database's sentence. On those two screens the list is the
// only refusal the database makes, so either wording, or the database's own
// sentence when it does come through, is shown as the sentence below. Any
// other message is left as it is.
export const NOT_ON_THE_LIST =
  "This email is not on the hub's list, so no account was made. Ask the administrator to add it first.";

const LIST_REFUSALS = [
  /^database error (saving|creating) new user\.?$/i,
  /not on the hub's list/i,
];

export const signupRefusal = (message?: string | null): string | undefined => {
  if (!message) return message ?? undefined;
  return LIST_REFUSALS.some((pattern) => pattern.test(message.trim()))
    ? NOT_ON_THE_LIST
    : message;
};
