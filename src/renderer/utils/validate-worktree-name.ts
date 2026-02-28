// Must be a valid git branch name: no spaces, no .., no control chars,
// no ~^:?\*[, can't start/end with dot or slash, no consecutive dots/slashes.
export function validateWorktreeName(name: string): string | null {
  if (!name) return null;
  if (/\s/.test(name)) return 'Name cannot contain spaces';
  if (/\.\./.test(name)) return 'Name cannot contain ".."';
  if (/\/\//.test(name)) return 'Name cannot contain consecutive slashes';
  if (/[~^:?*\[\]\\]/.test(name)) return 'Name contains invalid characters';
  if (name.startsWith('.') || name.startsWith('/')) return 'Name cannot start with "." or "/"';
  if (name.endsWith('.') || name.endsWith('/') || name.endsWith('.lock')) return 'Invalid ending';
  return null;
}
