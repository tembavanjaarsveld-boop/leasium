# Leasium Deployment

## Vercel Web App

The Vercel project should deploy the Next.js frontend from `apps/web`.

Recommended Vercel project settings:

- Root Directory: `apps/web`
- Framework Preset: `Next.js`
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm build`
- Output Directory: leave blank/default

Required Vercel environment variable:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-api-host.example.com/api/v1
```

The web app is only the frontend. The FastAPI backend still needs a separate host.

## API Host

Set the API host environment from `.env.example`, with production values for:

- `DATABASE_URL`
- `REDIS_URL`
- `FRONTEND_URL`
- `OPENAI_API_KEY`
- `S3_ENDPOINT_URL`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET`
- `S3_REGION`

`FRONTEND_URL` must match the Vercel domain so browser requests pass CORS.
