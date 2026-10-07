/**
 * Validate a user/API/LLM supplied git ref before it reaches `git` argv.
 *
 * Without this, a value such as `--output=C:\Users\me\x.txt` passed as the
 * base branch is parsed by git as an OPTION and writes the diff to a file.
 */
const REF=/^[A-Za-z0-9_][A-Za-z0-9._/~^@{}-]{0,199}$/;

export function assertSafeGitRef(ref:unknown,label="git ref"):string{
  if(typeof ref!=="string")throw new Error(`${label} must be a string.`);
  const value=ref.trim();
  if(!REF.test(value))throw new Error(`Unsafe ${label}: only letters, digits and . _ / ~ ^ @ { } - are allowed, and it cannot start with "-".`);
  if(value.includes("..")||value.includes("//")||value.endsWith("/")||value.endsWith(".lock")||value.includes("@{-"))
    throw new Error(`Unsafe ${label}.`);
  return value;
}
