# Clarivex Website Developer Guidelines

<!-- BEGIN:nextjs-agent-rules -->
## ⚠️ Next.js 16.2.6 Breaking Changes

This project uses **Next.js 16.2.6** with breaking changes — APIs, conventions, and file structure may differ from older versions. **Always** read the relevant guide in `node_modules/next/dist/docs/` before writing code. Heed deprecation notices.

Key differences:
- React 19.2.4 (with new features and changes from v18)
- Updated App Router patterns
- Tailwind CSS 4 changes
<!-- END:nextjs-agent-rules -->

## Project Overview

**Clarivex** is a business automation consulting website specializing in process automation and integration services.

**Tech Stack:**
- Frontend: Next.js 16.2.6 (App Router), React 19.2.4, TypeScript 5, Tailwind CSS 4
- Backend: Node.js API routes, Python automation scripts
- Integrations: Clockify (time tracking), Resend (email), Bitcoin data fetching
- Styling: Tailwind CSS 4 with custom color palette (`powder-*`, `dark-blue`)

## Quick Start

```bash
npm run dev          # Development server on http://localhost:3000
npm run build        # Production build
npm start            # Start production server
npm run lint         # Run ESLint
```

**Environment Variables** (`.env.local`):
- `CLOCKIFY_API_KEY` - Clockify workspace API key (used by `clockify_entry.py`)
- `RESEND_API_KEY` - Resend email service API key
- `RESEND_FROM_EMAIL` - Sender for password reset emails, on a domain verified in Resend (e.g. `Clarivex <no-reply@clarivex.app>`). Defaults to `onboarding@resend.dev`, which only delivers to the Resend account owner
- `SITE_URL` - Public site URL used in password reset links (e.g. `https://clarivex.app`). Set in production; locally it falls back to the request's host
- `OPENAI_API_KEY` - OpenAI API key (LangChain/LangGraph agents: trip planner, financial analysis; web search for the Trends page)
- `TAVILY_API_KEY` - Tavily web search API key (Financial Analysis web search agent)
- `ALPHA_VANTAGE_API_KEY` - Alpha Vantage API key (Financial Analysis stock data agent)
- `DATABASE_URL` - PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/clarivex`. Passed to `pg` as-is, plus `search_path=racingcoach`. Required; tables are created on first use (`ensureUserSchema()` in `src/lib/users.ts`). Everything lives in the `racingcoach` schema: `"Users"` (role `Admin` for the site owner, `User` for everyone else), `"Friends"` (each user's own Racing friends list, linked by `user_id`), `"Sessions"` and `"PasswordResets"`
- `STRIPE_SECRET_KEY` - Stripe secret key (Checkout Session creation, success page lookup)
- `STRIPE_MONTHLY_PRODUCT_ID` - Stripe Product ID for the Account page's Monthly Subscription button; its default Price must be recurring
- `STRIPE_LIFETIME_PRODUCT_ID` - Stripe Product ID for the Lifetime Subscription button; its default Price must be one-time. A paid purchase sets the account status to `Lifetime Subscription` with no end date, and cancels any monthly subscription the user had
- `STRIPE_WEBHOOK_SECRET` - Signing secret for `/api/stripe-webhook` (syncs `racingcoach."Users".account_status` with the subscription: `Unsubscribed`, `Monthly Subscription`, `Lifetime Subscription`, `Canceled`, `Expired`; see `src/lib/accountStatus.ts`). Must receive `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid` and `customer.subscription.deleted`
- `ATLASSIAN_API_KEY` - Atlassian API token for Jira Cloud (gordon-darby.atlassian.net, used by the Jira page)

## Project Structure

```
src/
├── app/              # App Router root
│   ├── layout.tsx    # Root layout with Navigation & Footer
│   ├── page.tsx      # Home page (Bitcoin ticker, hero, CTA)
│   ├── globals.css   # Global Tailwind styles
│   ├── api/
│   │   ├── bitcoin/      # Bitcoin price ticker data
│   │   ├── contact/      # Contact form submissions (Resend)
│   │   └── inquiry/      # Business inquiry handling
│   ├── contact/      # Contact page
│   ├── solutions/    # Solutions showcase page
└── components/       # Reusable React components
    ├── Navigation.tsx
    ├── Footer.tsx
    ├── BitcoinTicker.tsx
    ├── ContactForm.tsx
```

**Python Components** (backend automation):
- `clockify_entry.py` - Automated Clockify time entry management
- `plot_stock.py` - Generates a stock closing-price chart (PNG, base64 over stdout) from live Alpha Vantage data; invoked as a subprocess from `src/lib/financialAnalysis.ts`'s CodeAgent node
- `requirements.txt` - Python dependencies (requires `pandas`/`matplotlib` for `plot_stock.py`)

## Development Conventions

### File Organization
- **Page components** in `src/app/[route]/page.tsx`
- **API routes** in `src/app/api/[feature]/route.ts`
- **Reusable components** in `src/components/`
- **One component per file** with matching exported name

### Styling
- Use Tailwind CSS utility classes (no CSS-in-JS)
- Custom colors: `powder-500/600` (primary), `dark-blue` (text), `slate-*` (neutrals)
- Gradients common in hero sections and CTAs: `bg-gradient-to-r from-powder-500 to-powder-600`

### API Route Patterns
- Validate input early (required fields, email format)
- Check environment variables before making external calls
- Return `NextResponse.json()` with appropriate status codes
- Handle errors gracefully with clear error messages

**Example API route structure:**
```typescript
export async function POST(request: Request) {
  try {
    const body = await request.json();
    // Validate
    if (!body.requiredField) {
      return NextResponse.json({ error: 'Missing field' }, { status: 400 });
    }
    // Process
    // Return
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

## External Integrations

### Clockify API
- **Workspace ID**: `5f5fb2a73ab33d735bc7ca3a`
- **Docs**: https://docs.clockify.me/
- **Python tool** (`clockify_entry.py`): Creates time entries, respects workdays/holidays

### Resend Email Service
- **Docs**: https://resend.com/docs
- **Usage**: Contact form submissions sent via Resend
- **Config**: API key in `.env.local`

### Bitcoin Ticker
- Fetches real-time Bitcoin price data
- Component: `BitcoinTicker.tsx`
- No external API—check route implementation for data source

## Linting & Code Quality

**ESLint configuration** (`eslint.config.mjs`):
- Next.js Core Web Vitals rules
- TypeScript support
- Uses modern ESLint flat config format

```bash
npm run lint         # Check all files
```

**Ignored paths**: `.next/`, `out/`, `build/`, `next-env.d.ts`

## Common Tasks

### Add a New Page
1. Create file: `src/app/[page-name]/page.tsx`
2. Export default React component
3. Add route to `Navigation.tsx` if needed

### Add an API Endpoint
1. Create `src/app/api/[feature]/route.ts`
2. Implement `GET`, `POST`, etc. handlers
3. Add env variables to `.env.local` if needed

### Update Tailwind Styles
1. Edit `tailwind.config.ts` for theme/colors
2. Use classes in components (auto-generated)
3. No build step needed—watch mode handles it

## Troubleshooting

**npm run dev fails with "command not found"?**
- Ensure Node.js 18+ is installed
- Run `npm install` first
- Check that `.env.local` exists (can be empty initially)

**ESLint errors on import statements?**
- Verify TypeScript path aliases in `tsconfig.json` (e.g., `@/*` → `src/*`)
- Run `npm run lint -- --fix` to auto-fix common issues

**Build succeeds but `npm start` is slow?**
- Normal for first cold start
- Production bundle includes optimizations
- Subsequent requests are faster

## Related Documentation

- [Next.js Documentation](https://nextjs.org/docs)
- [React 19 Upgrade Guide](https://react.dev/blog/2024/12/19/react-19)
- [Tailwind CSS 4 Changelog](https://tailwindcss.com/docs/v4)
- [TypeScript Configuration](tsconfig.json)
