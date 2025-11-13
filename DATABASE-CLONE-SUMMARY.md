# 📋 TL;DR - Clone Your Supabase Database

## 🎯 What You're Doing

Creating a separate development database so you can:

- Test features without affecting real users
- Experiment safely
- Keep production data secure

---

## ⚡ Quick Steps

### 1️⃣ Create Dev Database (2 minutes)

1. Go to https://supabase.com/dashboard
2. Click **"New project"**
3. Name: `nexxus-cleaning-dev`
4. Create password (save it!)
5. Same region as production
6. Click **"Create"** and wait ~3 minutes

### 2️⃣ Clone Schema (1 minute)

1. Open **SQL Editor** in your **dev project**
2. Copy everything from `supabase/schema.sql` (this file in your project)
3. Paste and click **"Run"**
4. Wait for "Success" message
5. ✅ Verify: Run `verify-schema.sql` to confirm everything imported correctly

### 3️⃣ Get Credentials (1 minute)

**From Dev Project:**

- Settings → API
- Copy: URL, anon key, service_role key

**From Production Project:**

- Settings → API
- Copy: URL, anon key, service_role key

### 4️⃣ Create Environment Files (2 minutes)

Create `.env.development.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-dev-url.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-dev-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-dev-service-role-key
```

Create `.env.production.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-prod-url.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-prod-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-prod-service-role-key
```

### 5️⃣ Test It! (1 minute)

```bash
npm run dev
```

- Sign up a test user
- Check Supabase dev dashboard
- User should appear there (not in production!) ✅

---

## 📚 Full Documentation

- **Detailed Guide**: `DATABASE-SETUP-GUIDE.md`
- **Quick Reference**: `ENV-SETUP-QUICK-REFERENCE.md`
- **Deployment**: `PRODUCTION-DEPLOYMENT.md`

---

## 🚨 Important Notes

✅ **Your schema file is ready**: `supabase/schema.sql`  
✅ **Environment files are git-ignored**: Safe from commits  
❌ **Never commit `.env*.local` files**  
❌ **Never share service_role keys**  
✅ **Always test in dev first**

---

## 🎉 You're Done!

Now you have:

- 🟦 **Dev Database**: For testing and development
- 🟩 **Prod Database**: For real users
- 🔄 **Automatic switching**: `npm run dev` = dev, `npm start` = prod
- 🛡️ **Safe development**: Never touch production data again!

---

**Total Time**: ~7 minutes  
**Difficulty**: Easy  
**Cost**: Free (both can be on free tier)

Happy coding! 🚀
