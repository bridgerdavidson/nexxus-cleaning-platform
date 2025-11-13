# 🚀 Production Deployment Guide

## Overview

This guide covers deploying your app with the **production database** to hosting platforms.

---

## 🔷 Deploying to Vercel (Recommended for Next.js)

### Step 1: Push Your Code to Git
```bash
git add .
git commit -m "Set up dev and prod database environments"
git push
```

### Step 2: Connect to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Click **"Add New Project"**
3. Import your Git repository
4. Click **"Import"**

### Step 3: Add Environment Variables in Vercel
1. In the **"Configure Project"** screen, expand **"Environment Variables"**
2. Add these three variables for **Production**:

| Name | Value | Environment |
|------|-------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your prod URL | Production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your prod anon key | Production |
| `SUPABASE_SERVICE_ROLE_KEY` | Your prod service role key | Production |

3. **Optional**: Add dev credentials for **Preview** deployments:

| Name | Value | Environment |
|------|-------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your dev URL | Preview |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your dev anon key | Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | Your dev service role key | Preview |

### Step 4: Deploy
1. Click **"Deploy"**
2. Wait 2-3 minutes
3. Visit your production URL
4. Test: Sign up a user and verify they appear in your **production** database

### Step 5: Configure Supabase Auth Redirects
1. Go to your **production** Supabase project
2. Navigate to **Authentication** → **URL Configuration**
3. Add your Vercel URL to:
   - **Site URL**: `https://your-app.vercel.app`
   - **Redirect URLs**: Add `https://your-app.vercel.app/**`

---

## 🔷 Deploying to Netlify

### Step 1: Push to Git
```bash
git add .
git commit -m "Set up dev and prod database environments"
git push
```

### Step 2: Connect to Netlify
1. Go to [netlify.com](https://netlify.com)
2. Click **"Add new site"** → **"Import an existing project"**
3. Connect your Git repository

### Step 3: Configure Build Settings
- **Build command**: `npm run build`
- **Publish directory**: `.next`

### Step 4: Add Environment Variables
1. Go to **Site settings** → **Environment variables**
2. Add production database credentials:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

### Step 5: Deploy & Configure Supabase
1. Click **"Deploy"**
2. In Supabase production project, add Netlify URL to **Authentication** → **URL Configuration**

---

## 🔷 Deploying to Other Platforms

### Railway
1. Connect GitHub repo
2. Add environment variables in **Variables** tab
3. Deploy automatically

### Render
1. Create new **Web Service**
2. Connect repository
3. Add environment variables in **Environment** section
4. Set build command: `npm run build`
5. Set start command: `npm start`

### DigitalOcean App Platform
1. Create new app
2. Link GitHub repo
3. Add environment variables
4. Deploy

---

## ✅ Post-Deployment Checklist

### Supabase Configuration
- [ ] Production database URL added to hosting platform
- [ ] Service role key configured (kept secret)
- [ ] Auth redirect URLs updated in Supabase dashboard
- [ ] Email templates configured (if using email auth)
- [ ] Rate limiting reviewed
- [ ] RLS policies tested

### Application Testing
- [ ] Can load the homepage
- [ ] Can sign up a new user
- [ ] User appears in **production** database
- [ ] Can log in
- [ ] Can create/read data (test core features)
- [ ] API routes work correctly

### Security
- [ ] Environment variables not exposed in client
- [ ] Service role key not visible in browser
- [ ] HTTPS enabled
- [ ] CORS configured correctly
- [ ] Rate limiting active

---

## 🔍 Troubleshooting

### Issue: "Invalid API Key"
**Solution**: 
- Double-check environment variables in hosting platform
- Make sure you're using **production** credentials, not dev
- Verify no extra spaces in keys

### Issue: "Not authorized" or RLS errors
**Solution**:
- Check RLS policies in Supabase dashboard
- Verify user is authenticated
- Test policies in Supabase SQL editor

### Issue: Auth redirects not working
**Solution**:
- Add your production domain to Supabase **Authentication** → **URL Configuration**
- Check **Redirect URLs** includes `https://yourdomain.com/**`
- Clear browser cache and try again

### Issue: Environment variables not loading
**Solution**:
- Redeploy after adding/changing environment variables
- Some platforms require manual redeploy
- Check variable names match exactly (case-sensitive)

---

## 🎯 Best Practices

### 1. Use Preview Deployments
Configure Vercel/Netlify preview deployments to use **dev database**:
- Preview branches → Dev database
- Production branch → Production database

### 2. Database Backups
Enable automatic backups in Supabase:
1. Go to **Settings** → **Database**
2. Enable **Point-in-time Recovery (PITR)** (paid feature)
3. Or regularly export using `pg_dump`

### 3. Monitoring
- Set up Supabase logging
- Monitor API usage
- Track error rates
- Set up alerts for critical issues

### 4. Separate API Keys
Never mix dev and prod credentials:
- Keep them in password manager
- Use separate Supabase organizations if needed
- Document which is which

---

## 📊 Environment Variables Reference

### Required for All Environments
```bash
NEXT_PUBLIC_SUPABASE_URL=         # Public, visible in browser
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # Public, but has RLS restrictions
SUPABASE_SERVICE_ROLE_KEY=        # Secret, server-side only
```

### Optional (Production)
```bash
NEXT_PUBLIC_SITE_URL=             # Your domain
NEXT_PUBLIC_API_URL=              # If using separate API
NODE_ENV=production               # Usually auto-set
```

---

## 🔗 Useful Links

- [Vercel Next.js Deployment](https://vercel.com/docs/concepts/next.js/overview)
- [Netlify Next.js Deployment](https://docs.netlify.com/frameworks/next-js/overview/)
- [Supabase Auth Configuration](https://supabase.com/docs/guides/auth)
- [Next.js Environment Variables](https://nextjs.org/docs/basic-features/environment-variables)

---

## 📝 Quick Commands

### Test Production Build Locally
```bash
# Use production environment variables
npm run build
npm start

# Verify connects to production database
# Then test in browser at http://localhost:3000
```

### Force Redeploy
```bash
# Trigger new deployment
git commit --allow-empty -m "Redeploy"
git push
```

### Check Environment Variables (Vercel CLI)
```bash
vercel env pull .env.vercel
cat .env.vercel
```

---

**Remember**: Always test in development first! 🛡️

