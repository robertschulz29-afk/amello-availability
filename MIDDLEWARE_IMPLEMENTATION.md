# Bello-Mandator Header Middleware

## Overview

This implementation ensures that all API requests include the required `Bello-Mandator: amello.en` header, which is needed by the backend API.

## Implementation Details

### 1. Constants (`lib/constants.ts`)
- Defines `DEFAULT_BELLO_MANDATOR = 'amello.en'` as a single source of truth
- Used consistently across all components

### 2. Middleware (`middleware.ts`)
- Intercepts all requests to `/api/*` routes
- Automatically adds the `Bello-Mandator` header if not present
- Preserves the header if already provided by the client
- Runs before any API route handler

### 3. API Client (`lib/api-client.ts`)
- Client-side utility that adds the header to all outgoing requests
- Uses the shared constant

### 4. API Routes (`app/api/scans/process/route.ts`)
- Extracts the header from incoming requests
- Forwards it to external API calls (e.g., Amello backend)

## How It Works

```
Client Request → Middleware → API Route → Backend API
     ↓              ↓            ↓            ↓
  Adds header  Ensures header  Forwards    Receives
  (optional)   is present      header      header
```

## Verification

To verify the middleware is working:

1. **Build the project**: The build output should show the middleware is included
   ```bash
   npm run build
   # Look for "ƒ Middleware" in the output
   ```

2. **Check request headers**: When making API calls, the header should be present
   - Client-side: `fetchJSON` adds it automatically
   - Server-side: Middleware ensures it exists
   - Backend calls: API routes forward it

3. **Test with curl**:
   ```bash
   # Without header (middleware will add it)
   curl http://localhost:3000/api/hotels
   
   # With header (middleware will preserve it)
   curl -H "Bello-Mandator: amello.en" http://localhost:3000/api/hotels
   ```

## Benefits

1. **Single source of truth**: The header value is defined once in `lib/constants.ts`
2. **Automatic**: No need to manually add the header in every API route
3. **Backward compatible**: Works with existing code that already adds the header
4. **Safety net**: Ensures the header is always present, even if client forgets to add it
5. **Consistent**: Same behavior across all API routes

## Files Changed

- `lib/constants.ts` - New constant definition
- `middleware.ts` - New middleware implementation
- `lib/api-client.ts` - Updated to use constant
- `app/api/scans/process/route.ts` - Updated to forward header to backend
