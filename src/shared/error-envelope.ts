/** Shared API failure shape. Success remains `{ data }` elsewhere. */
export type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
  };
};

export function errorEnvelope(code: string, message: string): ErrorEnvelope {
  return { error: { code, message } };
}
