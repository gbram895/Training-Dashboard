export function asString(param: string | string[] | undefined): string {
  if (typeof param !== 'string') {
    throw new Error('Expected a single path parameter');
  }
  return param;
}
