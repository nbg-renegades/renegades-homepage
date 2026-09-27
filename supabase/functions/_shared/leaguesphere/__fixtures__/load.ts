/**
 * Reads a recorded response by file name.
 *
 * Resolved relative to this module rather than to the working directory, so `deno test` works
 * from anywhere in the repo. Returns `unknown`: a fixture is untrusted input in exactly the
 * way a live response is, and every test that uses one puts it through the real parser.
 */
export async function loadFixture(name: string): Promise<unknown> {
  const url = new URL(name, import.meta.url);
  return JSON.parse(await Deno.readTextFile(url));
}
