# Keco Studio Desktop Shell

This is a Native SDK WebView application, not a second Keco Studio frontend.
It always opens the deployed product at
`https://keco-studio-main.vercel.app/projects?desktop=1`.

## Development

```bash
npm ci
npm run check
zig build run
```

`@native-sdk/cli` is locked to `0.10.1` in `package-lock.json`. The check
command verifies the manifest, applies the pinned Windows popup-blocking patch,
and checks the shell's static security contract. The popup patch intentionally
fails when Native SDK's expected Windows host source changes.

The shell has no JavaScript bridge, filesystem permission, local API server,
or bundled Next.js assets. It only permits in-window navigation to the Keco
Studio production origin.
