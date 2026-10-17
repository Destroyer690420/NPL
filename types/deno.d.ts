/**
 * Minimal Deno ambient declarations for the Supabase Edge Function runtime.
 * The edge code is type-checked by `tsc -p tsconfig.edge.json`, which includes
 * this file, so `Deno.*` resolves without installing the Deno toolchain.
 */
declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): void
  env: {
    get(key: string): string | undefined
  }
}
